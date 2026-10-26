// Dev-only stand-in webcam (`?fakecam=1`): an animated canvas stream, so the
// app — PvP duels included, with PVP_FAKE_DETECTOR=1 on the backend — can be
// driven in a browser that has no camera.
export function fakeCamRequested() {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).has("fakecam");
  } catch {
    return false;
  }
}

// `?fakecam=chars` draws two full-body character pictures instead of plain
// silhouettes, so pose tracking has two "people" to find.
function fakeCamMode() {
  try {
    return new URLSearchParams(window.location.search).get("fakecam");
  } catch {
    return null;
  }
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

export function createFakeCamStream(width = 1280, height = 720) {
  const chars = fakeCamMode() === "chars"
    ? [loadImage(`${import.meta.env.BASE_URL}characters/hinata-hyuga.jpeg`), loadImage(`${import.meta.env.BASE_URL}characters/sasuke-uchiha.jpeg`)]
    : null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // A timer rather than requestAnimationFrame, so the stream keeps producing
  // frames in a background tab.
  const draw = () => {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, `hsl(${(t * 20) % 360} 40% 30%)`);
    g.addColorStop(1, `hsl(${(t * 20 + 120) % 360} 40% 20%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    if (chars) {
      // Raw frame: the picture on the raw LEFT shows up on the screen's right.
      // Roughly webcam exposure: the pictures' white paper would otherwise sit
      // right at the bloom threshold and make every effect look blown out.
      ctx.filter = "brightness(0.6) contrast(1.05)";
      chars.forEach((img, i) => {
        if (!img.complete || !img.naturalWidth) return;
        const h = height * 0.95;
        const w = (img.naturalWidth / img.naturalHeight) * h;
        const cx = width * (i ? 0.75 : 0.25) + Math.sin(t * 0.8 + i) * 20;
        ctx.drawImage(img, cx - w / 2, height - h, w, h);
      });
      ctx.filter = "none";
    }
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < (chars ? 0 : 2); i++) {
      // One "player" silhouette per half; raw frame, so the browser mirrors it.
      const cx = width * (i ? 0.75 : 0.25) + Math.sin(t * 1.3 + i) * 30;
      ctx.beginPath();
      ctx.arc(cx, height * 0.35, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 110, height * 0.5, 220, height * 0.5);
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(`FAKE CAMERA ${t.toFixed(1)}s`, 24, 44);
  };
  draw();
  const timer = setInterval(draw, 33);
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  const stopTrack = track.stop.bind(track);
  track.stop = () => {
    clearInterval(timer);
    stopTrack();
  };
  return stream;
}
