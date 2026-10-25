// Body Flicker: moving faster than the eye. Frozen afterimages of the frame
// pop up at offsets and fade as if you were in several places at once,
// speed lines rush in from the edges, and it ends on one hard whoosh.
import * as THREE from "three";
import { ADDITIVE, Ghost, disposeTree, lerp, span } from "../kit";
import { SCREEN_VERT } from "../stage";

const DURATION = 4.2;
const FLICKER_FROM = 0.35;
const FLICKER_TO = 2.9;
const BLINK_EVERY = 0.2;
const GHOST_LIFE = 0.55;
const MAX_GHOSTS = 4;

const SPEED_FRAG = /* glsl */ `
uniform float uTime, uAmount;
uniform vec2 uRes;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float id = floor(a * 220.0);
  // Each angular slot gets a streak that flashes on and off per time step.
  float on = step(0.7, hash(id + floor(uTime * 18.0) * 13.0));
  float thin = 1.0 - smoothstep(0.0, 0.5, abs(fract(a * 220.0) - 0.5) * 2.0);
  float reach = mix(0.95, 0.35, uAmount * hash(id * 1.7));
  float m = on * thin * smoothstep(reach, reach + 0.25, r);
  gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * m * uAmount * 0.6, 1.0);
}`;

export default class BodyFlicker {
  static needs = [];
  static duration = DURATION;

  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.speed = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uRes: stage.bg.uniforms.uRes },
      vertexShader: SCREEN_VERT,
      fragmentShader: SPEED_FRAG,
      ...ADDITIVE,
      depthTest: false,
    });
    const lines = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.speed);
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    this.root.add(lines);
    this.ghosts = [];
    this._nextBlink = FLICKER_FROM;
    stage.scene.add(this.root);
  }

  _blink(t) {
    const st = this.stage;
    if (this.ghosts.length >= MAX_GHOSTS) {
      const old = this.ghosts.shift();
      old.ghost.mesh.removeFromParent();
      old.ghost.dispose();
      old.ghost.material.dispose();
      old.ghost.mesh.geometry.dispose();
    }
    const ghost = new Ghost(st, st.snapshot());
    this.root.add(ghost.mesh);
    // Alternate sides so the copies read as darting left and right.
    const side = this.ghosts.length % 2 ? 1 : -1;
    this.ghosts.push({ ghost, born: t, dx: side * (0.12 + Math.random() * 0.14), dy: (Math.random() - 0.5) * 0.05 });
    st.flash.setRGB(0.08, 0.08, 0.1);
    st.shake(0.01);
  }

  update(t) {
    const st = this.stage;
    if (t >= this._nextBlink && t < FLICKER_TO) {
      this._nextBlink = t + BLINK_EVERY * (0.7 + Math.random() * 0.6);
      this._blink(t);
    }
    for (const g of this.ghosts) {
      const age = span(t - g.born, 0, GHOST_LIFE);
      const u = g.ghost.uniforms;
      // Snap out to the offset, then drift back while fading.
      u.uOffset.value.set(g.dx * (1 - age * 0.6), g.dy);
      u.uAlpha.value = 0.75 * (1 - age);
      u.uTint.value.setRGB(0.9, 0.95, 1.1);
    }

    const amount = span(t, 0.1, FLICKER_FROM) * (1 - span(t, FLICKER_TO + 0.3, FLICKER_TO + 0.9));
    this.speed.uniforms.uTime.value = t;
    this.speed.uniforms.uAmount.value = amount;

    // Final whoosh.
    const end = t > FLICKER_TO ? Math.exp(-(t - FLICKER_TO) * 6) : 0;
    if (end > 0.02) {
      st.flash.setRGB(0.3 * end, 0.32 * end, 0.36 * end);
      st.shake(0.03 * end);
    }
    st.darken = 0.2 * amount;
    st.desaturate = 0.35 * amount;
    st.vignette = 0.2 + 0.4 * amount;
    st.aberration = lerp(0.02, 0.12, amount) + end * 0.3;
  }

  dispose() {
    this.ghosts.forEach((g) => g.ghost.dispose());
    disposeTree(this.root);
  }
}
