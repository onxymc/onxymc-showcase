// Export pipeline. Every format re-renders the showcase at the target resolution
// through the same renderer as the editor — no screenshot upscaling.
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { Showcase } from "../core/showcase";
import { computeLayout, drawShowcase, ensureFonts, loopTicks, type Layout } from "./showcaseRenderer";
import { loadShowcaseTextures } from "./showcaseData";
import { TICK_MS } from "../core/animation";

export interface ExportSize {
  preset: "native" | "1080p" | "1440p" | "4k" | "youtube" | "discord" | "custom";
  scale: number;
  width: number;
  height: number;
}
export const PRESETS: Record<Exclude<ExportSize["preset"], "native" | "custom">, [number, number, string]> = {
  "1080p": [1920, 1080, "1920×1080 (Full HD)"],
  "1440p": [2560, 1440, "2560×1440 (QHD)"],
  "4k": [3840, 2160, "3840×2160 (4K)"],
  youtube: [1280, 720, "YouTube thumbnail 1280×720"],
  discord: [1600, 900, "Discord showcase 1600×900"],
};

export interface Frame {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  render(tick: number): void;
  width: number;
  height: number;
  layout: Layout;
}

export async function prepareFrame(sc: Showcase, size: ExportSize, transparent: boolean, even = false): Promise<Frame & { loop: number }> {
  await ensureFonts(sc);
  const layout = computeLayout(sc);
  const { src, textures } = await loadShowcaseTextures(sc);
  let W: number, H: number, scale: number, ox = 0, oy = 0;
  if (size.preset === "native") {
    scale = Math.max(0.25, size.scale);
    W = Math.round(layout.width * scale);
    H = Math.round(layout.height * scale);
  } else {
    const [pw, ph] = size.preset === "custom" ? [size.width, size.height] : PRESETS[size.preset];
    W = Math.max(16, Math.min(8192, Math.round(pw)));
    H = Math.max(16, Math.min(8192, Math.round(ph)));
    scale = Math.min(W / layout.width, H / layout.height);
    ox = (W / scale - layout.width) / 2;
    oy = (H / scale - layout.height) / 2;
  }
  if (even) {
    W += W % 2;
    H += H % 2;
  }
  if (W * H > 8192 * 8192) throw new Error("Export is too large (max 67 megapixels)");
  let bg: ImageBitmap | null = null;
  if (sc.style.backgroundImage) bg = await fetch(sc.style.backgroundImage).then((r) => r.blob()).then((b) => createImageBitmap(b)).catch(() => null);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return {
    canvas,
    ctx,
    width: W,
    height: H,
    layout,
    loop: loopTicks(textures.values(), sc.style.animSpeed),
    render(tick: number) {
      drawShowcase(ctx, sc, layout, src, { scale, tick, transparent, backgroundImage: bg, offsetX: ox, offsetY: oy, canvasW: W, canvasH: H });
    },
  };
}

export async function exportPng(sc: Showcase, size: ExportSize, transparent: boolean, tick = 0): Promise<Uint8Array> {
  const f = await prepareFrame(sc, size, transparent);
  f.render(tick);
  return new Uint8Array(await (await f.canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

export interface AnimOpts {
  ticksPerFrame: number; // GIF: 1 = 20 fps, 2 = 10 fps …
  durationTicks: number | "auto";
  transparent: boolean;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export async function exportGif(sc: Showcase, size: ExportSize, o: AnimOpts): Promise<Uint8Array> {
  const f = await prepareFrame(sc, size, o.transparent);
  const total = o.durationTicks === "auto" ? f.loop : Math.max(1, o.durationTicks);
  const step = Math.max(1, o.ticksPerFrame);
  const gif = GIFEncoder();
  let prev: Uint32Array | null = null;
  let pending: { index: Uint8Array; palette: number[][]; delay: number; transparentIndex: number } | null = null;
  const flush = () => {
    if (!pending) return;
    gif.writeFrame(pending.index, f.width, f.height, { palette: pending.palette, delay: pending.delay, transparent: pending.transparentIndex >= 0, transparentIndex: Math.max(0, pending.transparentIndex), repeat: 0 });
    pending = null;
  };
  for (let t = 0; t < total; t += step) {
    if (o.signal?.aborted) throw new Error("Export cancelled");
    f.render(t);
    const data = f.ctx.getImageData(0, 0, f.width, f.height).data;
    const u32 = new Uint32Array(data.buffer.slice(0));
    const delay = step * TICK_MS;
    if (prev && pending && u32.length === prev.length && equal(u32, prev)) {
      (pending as any).delay += delay; // merge identical frames into one longer frame
    } else {
      flush();
      const palette = quantize(data, 256, o.transparent ? { format: "rgba4444", oneBitAlpha: true } : { format: "rgb565" });
      const index = applyPalette(data, palette, o.transparent ? "rgba4444" : "rgb565");
      const transparentIndex = o.transparent ? palette.findIndex((c: number[]) => c[3] === 0) : -1;
      pending = { index, palette, delay, transparentIndex };
      prev = u32;
    }
    o.onProgress?.(t / total);
    await yieldUI();
  }
  flush();
  gif.finish();
  return gif.bytes();
}

function equal(a: Uint32Array, b: Uint32Array) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function videoSupport(w = 1920, h = 1080): Promise<{ mp4: boolean; webm: boolean }> {
  if (typeof VideoEncoder === "undefined") return { mp4: false, webm: false };
  const test = async (codec: string) => {
    try {
      return !!(await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8_000_000, framerate: 30 })).supported;
    } catch {
      return false;
    }
  };
  return { mp4: await test("avc1.640034"), webm: await test("vp09.00.10.08") };
}

export async function exportVideo(sc: Showcase, size: ExportSize, o: { fps: number; durationTicks: number | "auto"; container: "mp4" | "webm"; quality: number; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<Uint8Array> {
  const f = await prepareFrame(sc, size, false, true);
  const totalTicks = o.durationTicks === "auto" ? Math.max(f.loop, 40) : o.durationTicks;
  const seconds = (totalTicks * TICK_MS) / 1000;
  const frames = Math.max(1, Math.round(seconds * o.fps));
  const bitrate = Math.round(f.width * f.height * o.fps * 0.12 * (0.4 + o.quality));
  let muxer: any, codec: string;
  if (o.container === "mp4") {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: f.width, height: f.height }, fastStart: "in-memory" });
    codec = "avc1.640034";
  } else {
    const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
    muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "V_VP9", width: f.width, height: f.height, frameRate: o.fps } });
    codec = "vp09.00.10.08";
  }
  let error: any = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (error = e) });
  enc.configure({ codec, width: f.width, height: f.height, bitrate, framerate: o.fps, latencyMode: "quality" });
  for (let i = 0; i < frames; i++) {
    if (o.signal?.aborted) {
      enc.close();
      throw new Error("Export cancelled");
    }
    if (error) throw error;
    // sample the game-tick clock at this video frame's time
    f.render(Math.floor((i / o.fps) * (1000 / TICK_MS)));
    const vf = new VideoFrame(f.canvas, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) });
    enc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    o.onProgress?.(i / frames);
    if (i % 4 === 0) await yieldUI();
  }
  await enc.flush();
  enc.close();
  if (error) throw error;
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}
