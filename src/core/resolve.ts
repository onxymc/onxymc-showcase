// Resolves which texture a pack actually uses for a catalog item, following
// 1.21.4+ item definitions (assets/<ns>/items/*.json) and model parent chains.
import type { ResolvedTexture } from "./types";
import { CATALOG_BY_KEY, CUSTOM_PREFIX } from "./catalog";
import { modelPathOf, texturePathOf, type PackView } from "./packView";

const MAX_PARENT_DEPTH = 16;

/** Picks the "default" model reference out of an item-definition model node. */
export function pickModelId(node: any, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 12) return null;
  const type = String(node.type ?? "").replace(/^minecraft:/, "");
  switch (type) {
    case "model":
      return typeof node.model === "string" ? node.model : null;
    case "special":
      return typeof node.base === "string" ? node.base : null;
    case "select":
      return pickModelId(node.fallback, depth + 1) ?? pickModelId(node.cases?.[0]?.model, depth + 1);
    case "condition":
      return pickModelId(node.on_false, depth + 1) ?? pickModelId(node.on_true, depth + 1);
    case "range_dispatch":
      return pickModelId(node.fallback, depth + 1) ?? pickModelId(node.entries?.[0]?.model, depth + 1);
    case "composite":
      for (const m of node.models ?? []) {
        const r = pickModelId(m, depth + 1);
        if (r) return r;
      }
      return null;
    default:
      return null;
  }
}

export interface ResolvedModel {
  textures: Record<string, string>;
  elements: any[] | null;
  parents: string[];
  display?: any;
  /** true when the chain ends in item/generated (flat sprite) */
  generated: boolean;
}

export async function resolveModel(view: PackView, modelId: string): Promise<ResolvedModel | null> {
  const textures: Record<string, string> = {};
  let elements: any[] | null = null;
  let display: any;
  const parents: string[] = [];
  let id: string | null = modelId;
  let generated = false;
  let found = false;
  for (let d = 0; id && d < MAX_PARENT_DEPTH; d++) {
    const bare = id.replace(/^minecraft:/, "");
    if (bare === "item/generated" || bare === "builtin/generated") {
      generated = true;
      break;
    }
    if (parents.includes(id)) break; // cycle
    parents.push(id);
    const json = await view.readJson(modelPathOf(id));
    if (!json || typeof json !== "object") {
      // vanilla parents such as item/handheld are not in the pack; handheld ⇒ generated.
      if (/^(minecraft:)?item\/handheld/.test(id)) generated = true;
      break;
    }
    found = true;
    if (json.textures && typeof json.textures === "object")
      for (const [k, v] of Object.entries(json.textures)) if (!(k in textures) && typeof v === "string") textures[k] = v;
    if (!elements && Array.isArray(json.elements)) elements = json.elements;
    if (!display && json.display) display = json.display;
    id = typeof json.parent === "string" ? json.parent : null;
  }
  if (!found) return null;
  return { textures, elements, parents, display, generated: generated && !elements };
}

export function resolveTextureRef(textures: Record<string, string>, ref: string): string | null {
  let r = ref;
  for (let i = 0; i < 12 && r.startsWith("#"); i++) r = textures[r.slice(1)] ?? "";
  return r && !r.startsWith("#") ? r : null;
}

export async function resolveItemTexture(view: PackView, key: string): Promise<ResolvedTexture | null> {
  if (key.startsWith(CUSTOM_PREFIX)) {
    const p = key.slice(CUSTOM_PREFIX.length);
    return view.has(p) ? { path: p, via: "custom" } : null;
  }
  const entry = CATALOG_BY_KEY.get(key);
  if (!entry) return null;
  if (entry.itemId) {
    const defs = [`assets/minecraft/items/${entry.itemId}.json`];
    let modelId: string | null = null;
    let via: ResolvedTexture["via"] = "model";
    for (const d of defs) {
      const json = await view.readJson(d);
      if (json?.model) {
        modelId = pickModelId(json.model);
        via = "item-definition";
        break;
      }
    }
    if (!modelId && view.has(`assets/minecraft/models/item/${entry.itemId}.json`)) modelId = `minecraft:item/${entry.itemId}`;
    if (modelId) {
      const m = await resolveModel(view, modelId);
      if (m) {
        const ref = m.textures.layer0 ? resolveTextureRef(m.textures, "#layer0") : null;
        const anyTex = ref ?? (m.elements ? resolveTextureRef(m.textures, Object.keys(m.textures)[0] ? `#${Object.keys(m.textures)[0]}` : "") : null);
        if (anyTex) {
          const path = texturePathOf(anyTex);
          if (view.has(path)) return { path, via, modelPath: modelPathOf(modelId), is3DModel: !!m.elements };
        }
      }
    }
  }
  for (const c of entry.candidates) if (view.has(c)) return { path: c, via: "direct" };
  return null;
}
