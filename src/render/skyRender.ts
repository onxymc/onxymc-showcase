// CPU sky renderer that reproduces Skyboxify's geometry, rotation and blend
// equations (see core/sky.ts for the source references). Used both for the
// Skybox Preview tab (perspective view) and the showcase "sky" cell (panorama).
import { SKY_PARTS, fadeAlpha, rotationDegrees, celestialAngle, type SkyLayerDef, type Blend } from "../core/sky";

type M3 = number[]; // row-major 3×3

const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const rot = (axis: "x" | "y" | "z", deg: number): M3 => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  if (axis === "x") return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === "y") return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const axisAngle = (ax: [number, number, number], deg: number): M3 => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  const [x, y, z] = ax;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
};
const transpose = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// JOML: new Matrix4f().rotateX(a).rotateY(b) == Rx·Ry
const PART_M = SKY_PARTS.map((p) => p.rot.reduce<M3>((m, [ax, d]) => mul(m, rot(ax as any, d as number)), [1, 0, 0, 0, 1, 0, 0, 0, 1]));
const PART_INV = PART_M.map(transpose);

export interface SkySource {
  layer: SkyLayerDef;
  image: ImageData;
}

export interface SkyView {
  dayTime: number; // ticks, 0 = 06:00
  /** camera yaw/pitch in degrees (yaw 0 = looking north / -Z), fov vertical degrees */
  yaw: number;
  pitch: number;
  fov: number;
  mode: "perspective" | "panorama";
  rain?: number;
  showVanillaSky?: boolean;
}

/** Vanilla-ish overworld sky colour (plains biome) scaled by daylight. */
export function vanillaSkyColor(dayTime: number): [number, number, number] {
  const a = celestialAngle(dayTime);
  const b = Math.min(1, Math.max(0, Math.cos(a * Math.PI * 2) * 2 + 0.5));
  return [0.47 * b, 0.65 * b, 1.0 * b];
}

function blendPixel(mode: Blend, dst: Float32Array, i: number, sr: number, sg: number, sb: number, sa: number, alpha: number) {
  let r = dst[i], g = dst[i + 1], b = dst[i + 2];
  switch (mode) {
    case "add": {
      const k = sa * alpha;
      r += sr * k; g += sg * k; b += sb * k;
      break;
    }
    case "alpha": {
      const k = sa * alpha;
      r = sr * k + r * (1 - k); g = sg * k + g * (1 - k); b = sb * k + b * (1 - k);
      break;
    }
    case "subtract":
      r = (1 - r) * sr * alpha; g = (1 - g) * sg * alpha; b = (1 - b) * sb * alpha;
      break;
    case "multiply": {
      const pr = sr * alpha, pg = sg * alpha, pb = sb * alpha, pa = sa * alpha;
      r = r * pr + r * (1 - pa); g = g * pg + g * (1 - pa); b = b * pb + b * (1 - pa);
      break;
    }
    case "dodge":
      r += sr * alpha; g += sg * alpha; b += sb * alpha;
      break;
    case "burn":
      r *= 1 - sr * alpha; g *= 1 - sg * alpha; b *= 1 - sb * alpha;
      break;
    case "screen":
      r = sr * alpha + r * (1 - sr * alpha); g = sg * alpha + g * (1 - sg * alpha); b = sb * alpha + b * (1 - sb * alpha);
      break;
    case "replace":
      r = sr; g = sg; b = sb;
      break;
    case "overlay":
      r = 2 * r * sr * alpha; g = 2 * g * sg * alpha; b = 2 * b * sb * alpha;
      break;
  }
  dst[i] = r < 0 ? 0 : r > 1 ? 1 : r;
  dst[i + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
  dst[i + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
}

/** Find the face + texel a world-space direction hits for a given layer transform. */
function sampleDir(img: ImageData, inv: M3, dx: number, dy: number, dz: number, out: number[]): boolean {
  // world → layer space
  const lx = inv[0] * dx + inv[1] * dy + inv[2] * dz;
  const ly = inv[3] * dx + inv[4] * dy + inv[5] * dz;
  const lz = inv[6] * dx + inv[7] * dy + inv[8] * dz;
  for (let p = 0; p < 6; p++) {
    const m = PART_INV[p];
    const x = m[0] * lx + m[1] * ly + m[2] * lz;
    const y = m[3] * lx + m[4] * ly + m[5] * lz;
    const z = m[6] * lx + m[7] * ly + m[8] * lz;
    if (y >= 0) continue; // base quad lies on the y = -s plane
    const k = 1 / -y;
    const px = x * k, pz = z * k;
    if (px < -1 || px > 1 || pz < -1 || pz > 1) continue;
    const uv = SKY_PARTS[p].uv;
    const u = uv[0] + ((px + 1) / 2) * (uv[2] - uv[0]);
    const v = uv[1] + ((pz + 1) / 2) * (uv[3] - uv[1]);
    const tx = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
    const ty = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
    const o = (ty * img.width + tx) * 4;
    const d = img.data;
    out[0] = d[o] / 255; out[1] = d[o + 1] / 255; out[2] = d[o + 2] / 255; out[3] = d[o + 3] / 255;
    return true;
  }
  return false;
}

export function layerTransform(layer: SkyLayerDef, dayTime: number): M3 {
  // Matrix: rotate(YP, -90) then rotate(axis, angle) — Skyboxify SkyLayer.extractRenderState
  let m = rot("y", -90);
  if (layer.rotate) m = mul(m, axisAngle(layer.axis, rotationDegrees(layer, dayTime)));
  return m;
}

export function renderSky(sources: SkySource[], view: SkyView, width: number, height: number): ImageData {
  const buf = new Float32Array(width * height * 3);
  const base = view.showVanillaSky === false ? [0, 0, 0] : vanillaSkyColor(view.dayTime);
  for (let i = 0; i < buf.length; i += 3) buf[i] = base[0], buf[i + 1] = base[1], buf[i + 2] = base[2];

  const active = sources
    .map((s) => ({ s, alpha: fadeAlpha(s.layer.fade, view.dayTime) * (s.layer.weather.includes("clear") ? 1 - (view.rain ?? 0) : view.rain ?? 0) }))
    .filter((x) => x.alpha > 1e-4)
    .map((x) => ({ ...x, inv: transpose(layerTransform(x.s.layer, view.dayTime)) }));

  const yaw = (view.yaw * Math.PI) / 180, pitch = (view.pitch * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = 1 / Math.tan(((view.fov * Math.PI) / 180) / 2);
  const aspect = width / height;
  const px = [0, 0, 0, 0];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let dx: number, dy: number, dz: number;
      if (view.mode === "panorama") {
        // cylindrical horizon strip: full 360° yaw, ±(fov/2) pitch
        const a = yaw + ((i + 0.5) / width) * Math.PI * 2;
        const e = pitch + (0.5 - (j + 0.5) / height) * ((view.fov * Math.PI) / 180);
        dx = Math.sin(a) * Math.cos(e); dy = Math.sin(e); dz = -Math.cos(a) * Math.cos(e);
      } else {
        const x = (((i + 0.5) / width) * 2 - 1) * aspect, y = 1 - ((j + 0.5) / height) * 2;
        // camera space (-z forward) → pitch → yaw
        const cx = x, cyy = y, cz = -f;
        const y2 = cyy * cp - cz * sp, z2 = cyy * sp + cz * cp;
        dx = cx * cy - z2 * sy; dz = cx * sy + z2 * cy; dy = y2;
      }
      const o = (j * width + i) * 3;
      for (const a of active) if (sampleDir(a.s.image, a.inv, dx, dy, dz, px)) blendPixel(a.s.layer.blend, buf, o, px[0], px[1], px[2], px[3], a.alpha);
    }
  }
  const img = new ImageData(width, height);
  for (let p = 0, q = 0; p < buf.length; p += 3, q += 4) {
    img.data[q] = buf[p] * 255; img.data[q + 1] = buf[p + 1] * 255; img.data[q + 2] = buf[p + 2] * 255; img.data[q + 3] = 255;
  }
  return img;
}

export function bitmapToImageData(bmp: ImageBitmap, maxW = 1536): ImageData {
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
