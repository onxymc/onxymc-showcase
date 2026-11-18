// Opens packs on demand and caches decoded textures with a memory budget.
// Nothing is loaded until a view needs it; offscreen/unused entries are evicted.
import { PackView, type RawAccess } from "./packView";
import { buildTimeline, parseAnimationMeta, type Timeline } from "./animation";
import { listFolder, readFolderFiles, readSourceBytes } from "../platform";
import type { PackRecord } from "./types";
import { resolveItemTexture } from "./resolve";

// ---------------------------------------------------------------- zip worker RPC
let worker: Worker | null = null;
let rid = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
function zipWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/zipWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.rid);
      if (!p) return;
      pending.delete(e.data.rid);
      e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error));
    };
  }
  return worker;
}
function call(msg: any, transfer: Transferable[] = []): Promise<any> {
  return new Promise((res, rej) => {
    const id = ++rid;
    pending.set(id, { res, rej });
    zipWorker().postMessage({ ...msg, rid: id }, transfer);
  });
}

async function zipAccess(id: string, load: () => Promise<Uint8Array>): Promise<RawAccess> {
  const bytes = await load();
  const r = await call({ type: "open", id, bytes }, [bytes.buffer]);
  const files: string[] = r.files;
  return {
    files,
    async read(paths) {
      try {
        const res = await call({ type: "read", id, paths });
        return new Map(res.entries);
      } catch (e: any) {
        if (e.message !== "NOT_OPEN") throw e;
        const again = await load(); // evicted from the worker: reopen
        await call({ type: "open", id, bytes: again }, [again.buffer]);
        return new Map((await call({ type: "read", id, paths })).entries);
      }
    },
  };
}

export async function rawAccessFor(rec: Pick<PackRecord, "id" | "sourceKind" | "sourcePath">): Promise<RawAccess> {
  if (rec.sourceKind === "folder") {
    const files = await listFolder(rec.sourcePath);
    return { files, read: (p) => readFolderFiles(rec.sourcePath, p) };
  }
  return zipAccess(rec.id, () => readSourceBytes(rec.sourceKind, rec.sourcePath));
}

// ---------------------------------------------------------------- open views (LRU)
const views = new Map<string, Promise<PackView>>();
const MAX_VIEWS = 24;
let packLookup: (id: string) => PackRecord | undefined = () => undefined;
export function setPackLookup(fn: typeof packLookup) {
  packLookup = fn;
}

export function getPackView(id: string): Promise<PackView> {
  let v = views.get(id);
  if (v) {
    views.delete(id);
    views.set(id, v);
    return v;
  }
  const rec = packLookup(id);
  if (!rec) return Promise.reject(new Error("Pack not in library"));
  v = rawAccessFor(rec).then((raw) => PackView.open(raw));
  v.catch(() => views.delete(id));
  views.set(id, v);
  while (views.size > MAX_VIEWS) views.delete(views.keys().next().value!);
  return v;
}

export function invalidatePack(id: string) {
  views.delete(id);
  resolveCache.forEach((_, k) => k.startsWith(id + "|") && resolveCache.delete(k));
  for (const k of [...texCache.keys()]) if (k.startsWith(id + "|")) evict(k);
  if (worker) call({ type: "close", id }).catch(() => {});
}

// ---------------------------------------------------------------- textures
export interface LoadedTexture {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  timeline: Timeline | null;
  animError?: string;
  bytes: number;
}

const texCache = new Map<string, Promise<LoadedTexture | null>>();
const texSize = new Map<string, number>();
let texBudget = 256 * 1024 * 1024;
let texUsed = 0;
export function setTextureBudgetMB(mb: number) {
  texBudget = Math.max(32, mb) * 1024 * 1024;
  enforceBudget();
}
export function textureCacheStats() {
  return { entries: texCache.size, usedMB: texUsed / 1048576, budgetMB: texBudget / 1048576 };
}
export function clearTextureCache() {
  for (const k of [...texCache.keys()]) evict(k);
  resolveCache.clear();
}
function evict(k: string) {
  const p = texCache.get(k);
  texCache.delete(k);
  texUsed -= texSize.get(k) ?? 0;
  texSize.delete(k);
  p?.then((t) => t?.bitmap.close()).catch(() => {});
}
function enforceBudget() {
  while (texUsed > texBudget && texCache.size > 1) evict(texCache.keys().next().value!);
}

const MAX_DIM = 8192;

export async function decodePng(bytes: Uint8Array): Promise<ImageBitmap> {
  // Check the PNG signature + IHDR size before handing it to the decoder.
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) throw new Error("Not a PNG file");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  if (!w || !h || w > MAX_DIM || h > MAX_DIM * 8) throw new Error(`PNG dimensions ${w}×${h} are out of range`);
  return createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

export function getTexture(packId: string, path: string): Promise<LoadedTexture | null> {
  const key = `${packId}|${path}`;
  const hit = texCache.get(key);
  if (hit) {
    texCache.delete(key);
    texCache.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const view = await getPackView(packId);
    const got = await view.readBytes([path, path + ".mcmeta"]);
    const png = got.get(path);
    if (!png) return null;
    const bitmap = await decodePng(png);
    let timeline: Timeline | null = null;
    let animError: string | undefined;
    const mc = got.get(path + ".mcmeta");
    if (mc) {
      try {
        const meta = parseAnimationMeta(JSON.parse(new TextDecoder().decode(mc).replace(/^﻿/, "")));
        if (meta) {
          const tl = buildTimeline(meta, bitmap.width, bitmap.height);
          if ("error" in tl) animError = tl.error;
          else timeline = tl;
        }
      } catch {
        animError = "Malformed .png.mcmeta";
      }
    }
    const bytes = bitmap.width * bitmap.height * 4;
    texSize.set(key, bytes);
    texUsed += bytes;
    queueMicrotask(enforceBudget);
    return { bitmap, width: bitmap.width, height: bitmap.height, timeline, animError, bytes };
  })();
  p.catch(() => {
    texCache.delete(key);
  });
  texCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------- item → texture resolution
const resolveCache = new Map<string, Promise<string | null>>();
export function resolveTexturePath(packId: string, key: string): Promise<string | null> {
  const k = `${packId}|${key}`;
  let p = resolveCache.get(k);
  if (!p) {
    p = getPackView(packId)
      .then((v) => resolveItemTexture(v, key))
      .then((r) => r?.path ?? null)
      .catch(() => null);
    resolveCache.set(k, p);
  }
  return p;
}

export async function getItemTexture(packId: string, key: string, fallbackPackId?: string | null): Promise<LoadedTexture | null> {
  const path = await resolveTexturePath(packId, key);
  if (path) {
    const t = await getTexture(packId, path).catch(() => null);
    if (t) return t;
  }
  if (fallbackPackId && fallbackPackId !== packId) return getItemTexture(fallbackPackId, key, null);
  return null;
}
