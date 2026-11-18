// Minecraft `.png.mcmeta` animation semantics, mirroring the vanilla client:
//  - one game tick = 50 ms; `frametime` (default 1) is in ticks
//  - frame size: width/height if given, else a square of min(imageW, imageH)
//  - frames are read left→right, top→bottom from the sheet
//  - `frames` may be ints or {index, time}; default order is 0..n-1
//  - `interpolate` blends current→next linearly over the frame's ticks
import type { AnimationMeta } from "./types";

export const TICK_MS = 50;

export function parseAnimationMeta(json: unknown): AnimationMeta | null {
  if (!json || typeof json !== "object") return null;
  const a = (json as any).animation;
  if (!a || typeof a !== "object") return null;
  const posInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null);
  const frametime = posInt(a.frametime) ?? 1;
  let frames: AnimationMeta["frames"] = null;
  if (Array.isArray(a.frames)) {
    frames = [];
    for (const f of a.frames) {
      if (typeof f === "number" && f >= 0) frames.push({ index: Math.floor(f), time: frametime });
      else if (f && typeof f === "object" && typeof f.index === "number" && f.index >= 0)
        frames.push({ index: Math.floor(f.index), time: posInt(f.time) ?? frametime });
    }
  }
  return {
    frametime,
    interpolate: a.interpolate === true,
    frames,
    width: posInt(a.width),
    height: posInt(a.height),
  };
}

export interface Timeline {
  frameW: number;
  frameH: number;
  cols: number;
  sheetFrames: number;
  frames: { index: number; time: number }[];
  totalTicks: number;
  interpolate: boolean;
  /** start tick of each frame, for O(log n) lookups */
  starts: number[];
}

export function buildTimeline(meta: AnimationMeta, imageW: number, imageH: number): Timeline | { error: string } {
  let fw: number, fh: number;
  if (meta.width != null) fw = meta.width, fh = meta.height ?? imageH;
  else if (meta.height != null) fw = imageW, fh = meta.height;
  else fw = fh = Math.min(imageW, imageH);
  if (fw <= 0 || fh <= 0 || imageW % fw !== 0 || imageH % fh !== 0)
    return { error: `Image ${imageW}×${imageH} is not divisible into ${fw}×${fh} frames` };
  const cols = imageW / fw;
  const sheetFrames = cols * (imageH / fh);
  let frames = meta.frames ? meta.frames.filter((f) => f.index < sheetFrames) : null;
  if (!frames || frames.length === 0)
    frames = Array.from({ length: sheetFrames }, (_, i) => ({ index: i, time: meta.frametime }));
  const starts: number[] = [];
  let t = 0;
  for (const f of frames) {
    starts.push(t);
    t += f.time;
  }
  return { frameW: fw, frameH: fh, cols, sheetFrames, frames, totalTicks: t, interpolate: meta.interpolate, starts };
}

export interface FrameSample {
  /** position in the frames list */
  seq: number;
  index: number;
  nextIndex: number;
  /** blend weight of the next frame (0 when not interpolating) */
  mix: number;
  /** integer tick key — changes only when the visible image changes */
  key: number;
}

/** Sample the animation at a given (fractional) tick count. Interpolation steps per whole tick like vanilla. */
export function sampleTimeline(tl: Timeline, tick: number, loop = true): FrameSample {
  const n = tl.frames.length;
  let local = Math.floor(tick);
  if (loop) local = ((local % tl.totalTicks) + tl.totalTicks) % tl.totalTicks;
  else local = Math.min(Math.max(0, local), tl.totalTicks - 1);
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.starts[mid] <= local) lo = mid;
    else hi = mid - 1;
  }
  const f = tl.frames[lo];
  const nextSeq = loop ? (lo + 1) % n : Math.min(lo + 1, n - 1);
  const next = tl.frames[nextSeq];
  let mix = 0;
  if (tl.interpolate && next.index !== f.index) mix = (local - tl.starts[lo]) / f.time;
  return { seq: lo, index: f.index, nextIndex: next.index, mix, key: tl.interpolate ? local : lo };
}

export function frameRect(tl: Timeline, index: number) {
  return { x: (index % tl.cols) * tl.frameW, y: Math.floor(index / tl.cols) * tl.frameH, w: tl.frameW, h: tl.frameH };
}
