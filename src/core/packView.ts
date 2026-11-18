// A logical, read-only view over a resource pack (zip or folder) that applies the
// root-folder prefix and any pack overlays active for the target format.
import { parseLenientJson, parseMcmeta, TARGET_FORMAT, type ParsedMcmeta } from "./packMeta";

export interface RawAccess {
  files: string[];
  read(paths: string[]): Promise<Map<string, Uint8Array>>;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

export function detectRootPrefix(files: string[]): string {
  if (files.includes("pack.mcmeta")) return "";
  let best: string | null = null;
  for (const f of files) {
    if (f.endsWith("/pack.mcmeta")) {
      const pre = f.slice(0, -"pack.mcmeta".length);
      if (pre.split("/").length <= 3 && (best == null || pre.length < best.length)) best = pre;
    }
  }
  if (best != null) return best;
  if (files.some((f) => f.startsWith("assets/"))) return "";
  for (const f of files) {
    const i = f.indexOf("/assets/");
    if (i > 0 && f.slice(0, i).split("/").length <= 2) return f.slice(0, i + 1);
  }
  return "";
}

export class PackView {
  readonly map = new Map<string, string>(); // logical → physical
  readonly prefix: string;
  meta!: ParsedMcmeta;
  private textCache = new Map<string, string | null>();

  private constructor(private raw: RawAccess, prefix: string) {
    this.prefix = prefix;
  }

  static async open(raw: RawAccess, targetFormat = TARGET_FORMAT): Promise<PackView> {
    const v = new PackView(raw, detectRootPrefix(raw.files));
    const p = v.prefix;
    for (const f of raw.files) if (f.startsWith(p)) v.map.set(f.slice(p.length), f);
    const mc = await v.readText("pack.mcmeta");
    v.meta = parseMcmeta(mc);
    // Overlays: later entries win. Only overlays whose range includes the target apply.
    for (const o of v.meta.overlays) {
      if (o.min > targetFormat || o.max < targetFormat) continue;
      const pre = `${p}${o.directory}/`;
      for (const f of raw.files) if (f.startsWith(pre) && f.length > pre.length) v.map.set(f.slice(pre.length), f);
    }
    return v;
  }

  has(path: string) {
    return this.map.has(path);
  }
  list(): string[] {
    return [...this.map.keys()];
  }

  async readBytes(paths: string[]): Promise<Map<string, Uint8Array>> {
    const phys = new Map<string, string>();
    for (const l of paths) {
      const p = this.map.get(l);
      if (p) phys.set(p, l);
    }
    const got = await this.raw.read([...phys.keys()]);
    const out = new Map<string, Uint8Array>();
    for (const [p, b] of got) {
      const l = phys.get(p);
      if (l) out.set(l, b);
    }
    return out;
  }

  async readText(path: string): Promise<string | null> {
    if (this.textCache.has(path)) return this.textCache.get(path)!;
    const p = this.map.get(path) ?? (path === "pack.mcmeta" ? this.prefix + path : undefined);
    if (!p) return null;
    const got = await this.raw.read([p]);
    const b = got.get(p);
    const t = b ? decoder.decode(b) : null;
    if (t != null && t.length < 2_000_000) this.textCache.set(path, t);
    return t;
  }

  async readJson(path: string): Promise<any | null> {
    const t = await this.readText(path);
    if (t == null) return null;
    try {
      return parseLenientJson(t);
    } catch {
      return null;
    }
  }
}

/** "minecraft:item/foo" | "item/foo" → ["minecraft", "item/foo"] */
export function splitId(id: string): [string, string] {
  const i = id.indexOf(":");
  return i < 0 ? ["minecraft", id] : [id.slice(0, i) || "minecraft", id.slice(i + 1)];
}

export const texturePathOf = (id: string) => {
  const [ns, p] = splitId(id);
  return `assets/${ns}/textures/${p}.png`;
};
export const modelPathOf = (id: string) => {
  const [ns, p] = splitId(id);
  return `assets/${ns}/models/${p}.json`;
};
