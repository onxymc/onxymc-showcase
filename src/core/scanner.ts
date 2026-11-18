// Scans a PackView and produces a summary without decoding any textures.
import type { PackScanSummary } from "./types";
import type { PackView } from "./packView";
import { parseAnimationMeta } from "./animation";

const SKY_RE = /^assets\/minecraft\/(optifine|mcpatcher)\/sky\/(world-?\d+)\/(\w+)\.properties$/;

export async function scanPack(view: PackView): Promise<PackScanSummary> {
  const files = view.list();
  const warnings = [...view.meta.warnings];
  let textureCount = 0, itemTextures = 0, blockTextures = 0, customItemModelCount = 0;
  let hasItemDefinitions = false, hasCIT = false;
  const mcmetas: string[] = [];
  const skyLayers: string[] = [];
  for (const f of files) {
    if (/^assets\/[^/]+\/textures\/.+\.png$/.test(f)) {
      textureCount++;
      if (f.includes("/textures/item/") || f.includes("/textures/items/")) itemTextures++;
      else if (f.includes("/textures/block/") || f.includes("/textures/blocks/")) blockTextures++;
    } else if (f.endsWith(".png.mcmeta")) mcmetas.push(f);
    else if (/^assets\/[^/]+\/models\/item\/.+\.json$/.test(f)) customItemModelCount++;
    else if (/^assets\/[^/]+\/items\/.+\.json$/.test(f)) hasItemDefinitions = true;
    else if (/^assets\/minecraft\/(optifine|mcpatcher)\/cit\//.test(f)) hasCIT = true;
    if (SKY_RE.test(f)) skyLayers.push(f);
  }
  // Read mcmeta files (tiny) in one batch to find real animations.
  const animatedTextures: string[] = [];
  const toRead = mcmetas.filter((m) => view.has(m.slice(0, -".mcmeta".length))).slice(0, 4000);
  const bytes = await view.readBytes(toRead);
  const dec = new TextDecoder();
  for (const [p, b] of bytes) {
    try {
      const meta = parseAnimationMeta(JSON.parse(dec.decode(b).replace(/^﻿/, "")));
      if (meta) animatedTextures.push(p.slice(0, -".mcmeta".length));
    } catch {
      warnings.push(`Malformed animation metadata: ${p}`);
    }
  }
  if (textureCount === 0) warnings.push("No textures found under assets/*/textures");
  skyLayers.sort(skySort);
  return {
    textureCount,
    itemTextures,
    blockTextures,
    animatedTextures: animatedTextures.sort(),
    hasCustomItemModels: customItemModelCount > 0 || hasItemDefinitions,
    customItemModelCount,
    hasItemDefinitions,
    skyLayers,
    hasCIT,
    warnings: warnings.slice(0, 50),
    rootPrefix: view.prefix,
  };
}

/** Same ordering Skyboxify uses: by dimension folder, then numeric sky index. */
export function skySort(a: string, b: string) {
  const ma = a.match(SKY_RE), mb = b.match(SKY_RE);
  if (!ma || !mb) return a.localeCompare(b);
  if (ma[1] !== mb[1]) return ma[1] === "optifine" ? -1 : 1;
  if (ma[2] !== mb[2]) return ma[2].localeCompare(mb[2]);
  const na = parseInt(ma[3].replace("sky", ""), 10), nb = parseInt(mb[3].replace("sky", ""), 10);
  return (isNaN(na) ? -1 : na) - (isNaN(nb) ? -1 : nb);
}
export { SKY_RE };
