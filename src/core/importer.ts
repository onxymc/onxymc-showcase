// Imports packs into the library: scans in the background, never modifies the source.
import type { PackRecord } from "./types";
import { PackView } from "./packView";
import { scanPack } from "./scanner";
import { rawAccessFor, decodePng, invalidatePack, getItemTexture } from "./packAccess";
import { persistBrowserSource, statPath, type PickedSource } from "../platform";
import { uid } from "./showcase";
import { useApp } from "../state/store";
import { clearSkyCache } from "../render/showcaseData";

const PREVIEW_KEYS = ["netherite_sword", "netherite_chestplate", "totem_of_undying", "ender_pearl", "golden_apple", "mace", "diamond_sword", "heart"];

async function bitmapToDataUrl(bmp: ImageBitmap, size: number): Promise<string> {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = bmp.width > size;
  const k = Math.min(size / bmp.width, size / bmp.height);
  ctx.drawImage(bmp, (size - bmp.width * k) / 2, (size - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  return blobToDataUrl(await c.convertToBlob({ type: "image/png" }));
}
export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

function dominantColor(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): string | undefined {
  const d = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    const wgt = 0.15 + (mx - mn) / 255; // favour saturated pixels over outlines/handles
    r += d[i] * wgt; g += d[i + 1] * wgt; b += d[i + 2] * wgt; n += wgt;
  }
  if (!n) return undefined;
  const hx = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

async function makePreviewStrip(packId: string): Promise<{ url: string; color?: string } | null> {
  const cell = 32, n = 6;
  const found = [];
  for (const k of PREVIEW_KEYS) {
    if (found.length >= n) break;
    const t = await getItemTexture(packId, k).catch(() => null);
    if (t) found.push(t);
  }
  if (!found.length) return null;
  const c = new OffscreenCanvas(cell * found.length, cell);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  found.forEach((t, i) => {
    const fw = t.timeline?.frameW ?? t.width, fh = t.timeline?.frameH ?? t.height;
    const k = Math.max(1, Math.floor(cell / Math.max(fw, fh)));
    const s = Math.min(k, cell / Math.max(fw, fh));
    ctx.drawImage(t.bitmap, 0, 0, fw, fh, i * cell + (cell - fw * s) / 2, (cell - fh * s) / 2, fw * s, fh * s);
  });
  return { url: await blobToDataUrl(await c.convertToBlob({ type: "image/png" })), color: dominantColor(ctx, c.width, c.height) };
}

function stripExt(n: string) {
  return n.replace(/\.zip$/i, "");
}

async function buildRecord(base: Partial<PackRecord> & Pick<PackRecord, "id" | "sourceKind" | "sourcePath">, src: { name: string; size: number; modified: number }): Promise<PackRecord> {
  invalidatePack(base.id);
  clearSkyCache(base.id);
  const raw = await rawAccessFor(base);
  const view = await PackView.open(raw);
  const scan = await scanPack(view);
  let iconDataUrl: string | null = null;
  const icon = (await view.readBytes(["pack.png"])).get("pack.png");
  if (icon) {
    try {
      iconDataUrl = await bitmapToDataUrl(await decodePng(icon), 64);
    } catch {
      scan.warnings.push("pack.png could not be decoded");
    }
  }
  const st = useApp.getState();
  const rec: PackRecord = {
    name: stripExt(src.name),
    originalName: src.name,
    description: "",
    author: "",
    category: scan.animatedTextures.length ? "Animated" : "PvP",
    tags: [],
    favorite: false,
    featured: false,
    order: st.packs.length + 1000,
    addedAt: Date.now(),
    lastViewedAt: 0,
    customThumbnail: null,
    links: {},
    installedAs: null,
    ...base,
    packDescription: view.meta.description,
    sourceSize: src.size,
    sourceModified: src.modified,
    iconDataUrl,
    previewDataUrl: null,
    format: view.meta.format,
    scan,
  } as PackRecord;
  // Register first so texture lookups can resolve this pack, then render the preview strip.
  st.upsertPack(rec);
  const strip = await makePreviewStrip(rec.id).catch(() => null);
  rec.previewDataUrl = strip?.url ?? null;
  rec.accentColor = strip?.color;
  return rec;
}

export async function importSources(sources: PickedSource[]): Promise<PackRecord[]> {
  const st = useApp.getState();
  const results: PackRecord[] = [];
  let done = 0;
  st.setImporting({ done, total: sources.length, current: sources[0]?.name ?? "" });
  const baseOrder = st.packs.length;
  const queue = sources.map((s, i) => ({ s, order: baseOrder + i }));
  const errors: string[] = [];
  const worker = async () => {
    while (queue.length) {
      const { s: src, order } = queue.shift()!;
      useApp.getState().setImporting({ done, total: sources.length, current: src.name });
      try {
        const existing = src.path ? useApp.getState().packs.find((p) => p.sourcePath === src.path) : undefined;
        const id = existing?.id ?? uid();
        let sourcePath = src.path;
        let kind = src.kind;
        if (!src.path) {
          // browser mode: keep a private copy in IndexedDB
          sourcePath = `blob:${id}`;
          await persistBrowserSource(sourcePath, src);
          kind = src.kind === "folder" ? "folder" : "blob";
        }
        const rec = await buildRecord({ order, ...(existing ?? {}), id, sourceKind: kind, sourcePath }, src);
        useApp.getState().upsertPack(rec);
        results.push(rec);
      } catch (e: any) {
        errors.push(`${src.name}: ${e?.message ?? e}`);
      }
      done++;
    }
  };
  await Promise.all([worker(), worker()]);
  useApp.getState().setImporting(null);
  if (results.length) useApp.getState().toast(`Imported ${results.length} pack${results.length > 1 ? "s" : ""}`, "success");
  for (const e of errors) useApp.getState().toast(`Import failed — ${e}`, "error");
  return results;
}

/** Re-scan a pack after its source changed, keeping all user metadata. */
export async function refreshPack(id: string): Promise<boolean> {
  const p = useApp.getState().packs.find((x) => x.id === id);
  if (!p) return false;
  try {
    const st = p.sourcePath.startsWith("blob:") ? { size: p.sourceSize, modified: p.sourceModified, exists: true } : await statPath(p.sourcePath);
    if (!st.exists) throw new Error("The original file or folder can no longer be found");
    const rec = await buildRecord(p, { name: p.originalName, size: st.size, modified: st.modified });
    useApp.getState().upsertPack({ ...rec, name: p.name, order: p.order, addedAt: p.addedAt });
    useApp.getState().toast(`Refreshed ${p.name}`, "success");
    return true;
  } catch (e: any) {
    useApp.getState().toast(`Refresh failed: ${e?.message ?? e}`, "error");
    return false;
  }
}
