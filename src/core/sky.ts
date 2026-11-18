// Skyboxify / OptiFine custom-sky parsing. Ported from Skyboxify's own source
// (github.com/legacy-visuals-project/Skyboxify: SkyboxParser, SkyPart, Fade, SkyLayer)
// so previews follow the mod's real rules rather than guesses.
import type { PackView } from "./packView";
import { SKY_RE, skySort } from "./scanner";

export type Blend = "alpha" | "add" | "subtract" | "multiply" | "dodge" | "burn" | "screen" | "replace" | "overlay";
const BLENDS: Blend[] = ["alpha", "add", "subtract", "multiply", "dodge", "burn", "screen", "replace", "overlay"];

export interface SkyLayerDef {
  propertiesPath: string;
  dimension: string; // world0 / world-1 / world1
  texturePath: string;
  blend: Blend;
  fade: { alwaysOn: true } | { alwaysOn: false; startIn: number; endIn: number; startOut: number; endOut: number };
  rotate: boolean;
  speed: number;
  /** internal axis (already converted the way Skyboxify does: (z, y, -x)) */
  axis: [number, number, number];
  weather: string[];
  biomes: string | null;
  heights: string | null;
  days: string | null;
  warnings: string[];
}

/** Java .properties (subset sufficient for sky files: key=value / key: value, # and ! comments, \ continuations). */
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, "");
    if (!line || line[0] === "#" || line[0] === "!") continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, "");
    const m = line.match(/^((?:\\.|[^=:\s])+)\s*[=:\s]\s*(.*)$/);
    if (!m) {
      out[line.trim()] = "";
      continue;
    }
    out[m[1].replace(/\\(.)/g, "$1")] = m[2].replace(/\\(.)/g, "$1").trim();
  }
  return out;
}

/** "hh:mm" → ticks, exactly like Skyboxify (06:00 = 0). Returns -1 for invalid. */
export function toTickTime(time: string): number {
  const parts = time.trim().split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[1], 10), h0 = parseInt(parts[0], 10);
    if (h0 >= 0 && h0 <= 23 && m >= 0 && m <= 59) {
      let h = h0 - 6;
      if (h < 0) h += 24;
      return h * 1000 + Math.trunc((m / 60) * 1000);
    }
  }
  return -1;
}

const norm = (t: number) => ((t % 24000) + 24000) % 24000;
const cyc = (a: number, b: number) => (b - a + 24000) % 24000;
function inInterval(t: number, start: number, end: number) {
  return start <= end ? t >= start && t <= end : t >= start || t <= end;
}

export function fadeAlpha(f: SkyLayerDef["fade"], timeOfDay: number): number {
  if (f.alwaysOn) return 1;
  const t = norm(timeOfDay);
  if (inInterval(t, f.endIn, f.startOut)) return 1;
  if (inInterval(t, f.startIn, f.endIn)) return cyc(f.startIn, t) / Math.max(1, cyc(f.startIn, f.endIn));
  if (inInterval(t, f.startOut, f.endOut)) return 1 - cyc(f.startOut, t) / Math.max(1, cyc(f.startOut, f.endOut));
  return 0;
}

/** Vanilla celestial angle (fraction of a full turn) for a day time in ticks. */
export function celestialAngle(dayTime: number): number {
  const d = (((dayTime / 24000 - 0.25) % 1) + 1) % 1;
  const e = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + e) / 3;
}

export function rotationDegrees(layer: SkyLayerDef, dayTime: number): number {
  if (!layer.rotate) return 0;
  let start = 0;
  if (layer.speed !== Math.round(layer.speed)) {
    const day = Math.floor((dayTime + 18000) / 24000);
    start = ((day * (layer.speed % 1)) % 1 + 1) % 1;
  }
  return 360 * (start + celestialAngle(dayTime) * layer.speed);
}

function resolveSource(src: string | undefined, propsPath: string): string | null {
  // Mirrors ParserCodecs.getSourceTextureCodec
  if (src == null || src === "") return propsPath.replace(/\.properties$/, ".png");
  if (src.startsWith("./")) return propsPath.slice(0, propsPath.lastIndexOf("/") + 1) + src.slice(2);
  const parts = src.split("/");
  if (parts.length >= 3 && parts[0] === "assets") return src;
  const i = src.indexOf(":");
  const ns = i < 0 ? "minecraft" : src.slice(0, i);
  const p = i < 0 ? src : src.slice(i + 1);
  if (!/^[a-z0-9_.\-]+$/.test(ns) || !/^[a-z0-9_.\-/]+$/.test(p)) return null;
  return `assets/${ns}/${p}`;
}

export function parseSkyLayer(propertiesPath: string, text: string): SkyLayerDef | null {
  const m = propertiesPath.match(SKY_RE);
  if (!m) return null;
  const p = parseProperties(text);
  const warnings: string[] = [];
  const source = p.source;
  const texturePath = resolveSource(source, propertiesPath);
  if (!texturePath) return null;
  let blend = (p.blend ?? "add").toLowerCase() as Blend;
  if (!BLENDS.includes(blend)) {
    warnings.push(`Unknown blend "${p.blend}", using add`);
    blend = "add";
  }
  let fade: SkyLayerDef["fade"] = { alwaysOn: true };
  if (p.startFadeIn && p.endFadeIn && p.endFadeOut) {
    const si = toTickTime(p.startFadeIn), ei = toTickTime(p.endFadeIn), eo = toTickTime(p.endFadeOut);
    let so: number;
    if (p.startFadeOut) so = toTickTime(p.startFadeOut);
    else {
      so = eo - (ei - si);
      if (si <= so && ei >= so) so = eo;
    }
    if ([si, ei, eo, so].some((x) => x < 0)) warnings.push("Invalid fade time; treated as always visible");
    else fade = { alwaysOn: false, startIn: norm(si), endIn: norm(ei), startOut: norm(so), endOut: norm(eo) };
  }
  let axis: [number, number, number] = [1, 0, 0]; // file default "0 0 1" converted
  if (p.axis) {
    const v = p.axis.trim().split(/\s+/).map(Number);
    if (v.length === 3 && v.every(Number.isFinite) && v[0] ** 2 + v[1] ** 2 + v[2] ** 2 > 1e-6) {
      const len = Math.hypot(v[0], v[1], v[2]);
      axis = [v[2] / len, v[1] / len, -v[0] / len];
    } else warnings.push("Invalid axis; using default");
  }
  const speed = p.speed != null && Number.isFinite(parseFloat(p.speed)) ? parseFloat(p.speed) : 1;
  return {
    propertiesPath,
    dimension: m[2],
    texturePath,
    blend,
    fade,
    rotate: p.rotate == null ? true : p.rotate.trim().toLowerCase() === "true",
    speed,
    axis,
    weather: (p.weather ?? "clear").split(/\s+/).filter(Boolean),
    biomes: p.biomes ?? null,
    heights: p.heights ?? null,
    days: p.days ?? null,
    warnings,
  };
}

export async function loadSkyLayers(view: PackView, dimension = "world0"): Promise<SkyLayerDef[]> {
  const props = view.list().filter((f) => SKY_RE.test(f) && f.includes(`/sky/${dimension}/`)).sort(skySort);
  // Skyboxify prefers optifine/sky; mcpatcher/sky is only used when no optifine skies exist.
  const opti = props.filter((f) => f.includes("/optifine/sky/"));
  const use = opti.length ? opti : props;
  const out: SkyLayerDef[] = [];
  for (const f of use) {
    const t = await view.readText(f);
    if (t == null) continue;
    const l = parseSkyLayer(f, t);
    if (l && view.has(l.texturePath)) out.push(l);
  }
  return out;
}

/** Face UV rectangles from Skyboxify's SkyPart enum (3×2 sheet). */
export const SKY_PARTS = [
  { name: "bottom", uv: [0, 0, 1 / 3, 0.5], rot: [["y", 90]] },
  { name: "top", uv: [1 / 3, 0, 2 / 3, 0.5], rot: [["x", 180], ["y", -90]] },
  { name: "east", uv: [2 / 3, 0, 1, 0.5], rot: [["x", 90], ["z", 90]] },
  { name: "south", uv: [0, 0.5, 1 / 3, 1], rot: [["x", 90], ["z", 180]] },
  { name: "west", uv: [1 / 3, 0.5, 2 / 3, 1], rot: [["x", 90], ["z", -90]] },
  { name: "north", uv: [2 / 3, 0.5, 1, 1], rot: [["x", 90]] },
] as const;
