// Three.js stage for the cast phase. The webcam feed is drawn *inside* the
// scene (a full-screen background quad) rather than under a transparent
// canvas, so effects can light the player's skin, refract the image behind
// them, and share one bloom + camera-shake pass with the feed.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const FOV = 45;
const CAM_Z = 10;
const LIGHTS = 2;
// The feed is capped below the bloom threshold so only effects (which use
// HDR colors > 1) glow, not bright windows behind the player.
const BG_CEILING = 0.9;
const BLOOM_THRESHOLD = 0.95;

// Screen uv (bottom-left origin) -> video uv, with object-fit: cover and
// the selfie mirror. Must agree with coverMapper() in tracking.js. Needs
// uRes and uVideoSize uniforms.
export const COVER_GLSL = /* glsl */ `
vec2 coverUv(vec2 s) {
  float scale = max(uRes.x / uVideoSize.x, uRes.y / uVideoSize.y);
  vec2 ext = uVideoSize * scale;
  vec2 v = (s * uRes - (uRes - ext) * 0.5) / ext;
  v.x = 1.0 - v.x;
  return v;
}`;

// Full-screen quad in clip space; for layers that cover the viewport.
export const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

const BG_FRAG = /* glsl */ `
#define LIGHTS ${LIGHTS}
uniform sampler2D uVideo;
uniform vec2 uRes;
uniform vec2 uVideoSize;
uniform vec4 uWarp;            // xy center (uv), z radius (screen heights), w pinch
uniform float uTwist;          // swirl radians at the warp center
uniform vec4 uLight[LIGHTS];   // xy center (uv), z radius (screen heights), w intensity
uniform vec3 uLightColor[LIGHTS];
uniform float uDarken;
uniform float uDesat;
uniform float uInvert;
uniform float uContrast;
uniform vec3 uTint;
uniform vec3 uFlash;
varying vec2 vUv;

${COVER_GLSL}

void main() {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 s = vUv;

  vec2 d = (s - uWarp.xy) * aspect;
  float f = 1.0 - smoothstep(0.0, uWarp.z, length(d));
  float ang = uTwist * f * f;
  d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d * (1.0 - uWarp.w * f * f);
  s = uWarp.xy + d / aspect;

  vec3 c = texture2D(uVideo, coverUv(s)).rgb;
  c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), uDesat);
  c = mix(c, vec3(1.0) - c, uInvert);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  c *= uTint * (1.0 - uDarken);

  for (int i = 0; i < LIGHTS; i++) {
    float r = length((vUv - uLight[i].xy) * aspect) / max(uLight[i].z, 1e-4);
    float g = uLight[i].w / (1.0 + r * r * 8.0) * (1.0 - smoothstep(0.0, 1.5, r));
    // Mostly multiplicative so it reads as light falling on skin, plus a
    // little flat add so it still shows on dark clothing.
    c += uLightColor[i] * g * (0.18 + c * 1.6);
  }

  gl_FragColor = vec4(min(c, vec3(${BG_CEILING})) + uFlash, 1.0);
}`;

const POST_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uShake: { value: new THREE.Vector2() },
    uZoom: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0 },
    uVignetteColor: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uShake;
    uniform float uZoom, uAberration, uVignette;
    uniform vec3 uVignetteColor;
    varying vec2 vUv;
    void main() {
      vec2 uv = (vUv - 0.5) * (1.0 - uZoom) + 0.5 + uShake;
      vec2 d = uv - 0.5;
      vec2 off = d * dot(d, d) * uAberration;
      vec3 c = vec3(
        texture2D(tDiffuse, uv + off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - off).b);
      float v = smoothstep(0.12, 0.5, dot(d, d)) * uVignette;
      gl_FragColor = vec4(mix(c, uVignetteColor, v), 1.0);
    }`,
};

export class Stage {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_Z);

    this.videoTex = new THREE.VideoTexture(video);
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
    this.bg = new THREE.ShaderMaterial({
      uniforms: {
        uVideo: { value: this.videoTex },
        uRes: { value: new THREE.Vector2(1, 1) },
        uVideoSize: { value: new THREE.Vector2(1280, 720) },
        uWarp: { value: new THREE.Vector4() },
        uTwist: { value: 0 },
        uLight: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4()) },
        uLightColor: { value: Array.from({ length: LIGHTS }, () => new THREE.Color()) },
        uDarken: { value: 0 },
        uDesat: { value: 0 },
        uInvert: { value: 0 },
        uContrast: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: new THREE.Color(0, 0, 0) },
      },
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bg);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = -1000;
    this.scene.add(bgMesh);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.8, 0.4, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass(POST_SHADER);
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());

    this._shake = 0;
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z;
    this.visW = this.visH * this.camera.aspect;
    this.bg.uniforms.uRes.value.set(w, h);
  }

  // Viewport CSS px -> world point on the z = 0 plane (where effects live).
  toWorld(px, py, z = 0, target = new THREE.Vector3()) {
    return target.set((px / this.width - 0.5) * this.visW, (0.5 - py / this.height) * this.visH, z);
  }

  toWorldSize(px) {
    return (px / this.height) * this.visH;
  }

  // Per-frame look controls. Effects set these during update(); every
  // frame starts from neutral so an effect only describes what it wants now.
  beginFrame(dt) {
    const u = this.bg.uniforms;
    u.uWarp.value.set(0.5, 0.5, 0.0001, 0);
    u.uTwist.value = 0;
    u.uLight.value.forEach((l) => l.set(0, 0, 1, 0));
    u.uDarken.value = 0;
    u.uDesat.value = 0;
    u.uInvert.value = 0;
    u.uContrast.value = 1;
    u.uTint.value.setRGB(1, 1, 1);
    u.uFlash.value.setRGB(0, 0, 0);
    const p = this.post.uniforms;
    p.uAberration.value = 0.02;
    p.uVignette.value = 0.2;
    p.uVignetteColor.value.setRGB(0, 0, 0);
    this.bloom.strength = 0.8;
    this._shake *= Math.exp(-dt * 6);
    if (this.video.videoWidth) u.uVideoSize.value.set(this.video.videoWidth, this.video.videoHeight);
  }

  setWarp(px, py, radiusPx, pinch, twist) {
    const u = this.bg.uniforms;
    u.uWarp.value.set(px / this.width, 1 - py / this.height, radiusPx / this.height, pinch);
    u.uTwist.value = twist;
  }

  setLight(i, px, py, radiusPx, color, intensity) {
    const u = this.bg.uniforms;
    u.uLight.value[i].set(px / this.width, 1 - py / this.height, radiusPx / this.height, intensity);
    u.uLightColor.value[i].copy(color);
  }

  set darken(v) { this.bg.uniforms.uDarken.value = v; }
  set desaturate(v) { this.bg.uniforms.uDesat.value = v; }
  set invert(v) { this.bg.uniforms.uInvert.value = v; }
  set contrast(v) { this.bg.uniforms.uContrast.value = v; }
  get tint() { return this.bg.uniforms.uTint.value; }
  get flash() { return this.bg.uniforms.uFlash.value; }
  set aberration(v) { this.post.uniforms.uAberration.value = v; }
  set vignette(v) { this.post.uniforms.uVignette.value = v; }
  get vignetteColor() { return this.post.uniforms.uVignetteColor.value; }

  // Freeze the current camera frame into a texture (for afterimages /
  // ghosts). Sample it with coverUv() like the live feed.
  snapshot() {
    const v = this.video;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 2;
    c.height = v.videoHeight || 2;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // amount is in screen fractions (0.01 = 1% of the screen).
  shake(amount) {
    this._shake = Math.max(this._shake, amount);
  }

  render(dt) {
    const p = this.post.uniforms;
    const a = this._shake;
    p.uShake.value.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    p.uZoom.value = Math.min(0.08, a * 2.5);
    this.composer.render(dt);
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.scene.traverse((obj) => {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => m.dispose());
    });
    this.videoTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
