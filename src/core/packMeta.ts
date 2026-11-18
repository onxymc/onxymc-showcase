// pack.mcmeta parsing and pack-format → Minecraft version mapping.
import type { PackFormatInfo } from "./types";

export const TARGET_FORMAT = 75; // Java Edition 1.21.11
export const TARGET_VERSION = "1.21.11";

// Resource-pack formats of release versions.
const FORMAT_TABLE: [number, string, string][] = [
  [1, "1.6.1", "1.8.9"],
  [2, "1.9", "1.10.2"],
  [3, "1.11", "1.12.2"],
  [4, "1.13", "1.14.4"],
  [5, "1.15", "1.16.1"],
  [6, "1.16.2", "1.16.5"],
  [7, "1.17", "1.17.1"],
  [8, "1.18", "1.18.2"],
  [9, "1.19", "1.19.2"],
  [12, "1.19.3", "1.19.3"],
  [13, "1.19.4", "1.19.4"],
  [15, "1.20", "1.20.1"],
  [18, "1.20.2", "1.20.2"],
  [22, "1.20.3", "1.20.4"],
  [32, "1.20.5", "1.20.6"],
  [34, "1.21", "1.21.1"],
  [42, "1.21.2", "1.21.3"],
  [46, "1.21.4", "1.21.4"],
  [55, "1.21.5", "1.21.5"],
  [63, "1.21.6", "1.21.6"],
  [64, "1.21.7", "1.21.8"],
  [69, "1.21.9", "1.21.10"],
  [75, "1.21.11", "1.21.11"],
];

function lowVersion(fmt: number): string | null {
  // the earliest release whose format is >= fmt
  for (const [f, lo] of FORMAT_TABLE) if (f >= fmt) return lo;
  return null;
}
function highVersion(fmt: number): string | null {
  let best: string | null = null;
  for (const [f, , hi] of FORMAT_TABLE) if (f <= fmt) best = hi;
  return best;
}

export function formatToVersionLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Unknown version";
  const lo = min ?? max!;
  const hi = max ?? min!;
  const exact = FORMAT_TABLE.find(([f]) => f === lo);
  if (lo === hi) {
    if (exact) return exact[1] === exact[2] ? exact[1] : `${exact[1]} – ${exact[2]}`;
    if (lo > TARGET_FORMAT) return `Newer than ${TARGET_VERSION} (format ${lo})`;
    return `Format ${lo}`;
  }
  const a = lowVersion(lo) ?? `format ${lo}`;
  const b = hi > TARGET_FORMAT ? "newer" : highVersion(hi) ?? `format ${hi}`;
  return `${a} – ${b}`;
}

/** Lenient JSON: strips BOM, // and /* comments, and trailing commas (Minecraft's GSON is lenient too). */
export function parseLenientJson(text: string): any {
  const t = text.replace(/^﻿/, "");
  try {
    return JSON.parse(t);
  } catch {
    let out = "";
    let inStr = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        out += c;
        if (c === "\\") {
          out += t[++i] ?? "";
        } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
      } else if (c === "/" && t[i + 1] === "/") {
        while (i < t.length && t[i] !== "\n") i++;
      } else if (c === "/" && t[i + 1] === "*") {
        i += 2;
        while (i < t.length && !(t[i] === "*" && t[i + 1] === "/")) i++;
        i++;
      } else out += c;
    }
    out = out.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(out);
  }
}

/** Flattens a text component (string | object | array) to plain text, stripping § codes. */
export function textComponentToString(c: unknown, depth = 0): string {
  if (depth > 16 || c == null) return "";
  let s = "";
  if (typeof c === "string") s = c;
  else if (typeof c === "number" || typeof c === "boolean") s = String(c);
  else if (Array.isArray(c)) s = c.map((x) => textComponentToString(x, depth + 1)).join("");
  else if (typeof c === "object") {
    const o = c as Record<string, unknown>;
    s = (typeof o.text === "string" ? o.text : typeof o.translate === "string" ? o.translate : "") +
      (Array.isArray(o.extra) ? o.extra.map((x) => textComponentToString(x, depth + 1)).join("") : "");
  }
  return s.replace(/§./g, "");
}

function major(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (Array.isArray(v) && typeof v[0] === "number") return Math.floor(v[0]);
  return null;
}

function rangeOf(v: unknown): [number, number] | null {
  if (typeof v === "number") return [v, v];
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return [v[0], v[1]];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const a = o.min_inclusive, b = o.max_inclusive;
    if (typeof a === "number" && typeof b === "number") return [a, b];
  }
  return null;
}

export interface ParsedMcmeta {
  description: string;
  format: PackFormatInfo;
  overlays: { directory: string; min: number; max: number }[];
  warnings: string[];
}

export function parseMcmeta(text: string | null): ParsedMcmeta {
  const warnings: string[] = [];
  let json: any = null;
  if (text == null) warnings.push("pack.mcmeta is missing");
  else {
    try {
      json = parseLenientJson(text);
    } catch {
      warnings.push("pack.mcmeta is not valid JSON");
    }
  }
  const pack = json && typeof json === "object" ? json.pack ?? {} : {};
  const packFormat = typeof pack.pack_format === "number" ? pack.pack_format : null;
  let minF = major(pack.min_format);
  let maxF = pack.max_format !== undefined ? major(pack.max_format) : null;
  const sup = rangeOf(pack.supported_formats);
  if (minF == null && sup) minF = sup[0];
  if (maxF == null && sup) maxF = sup[1];
  if (minF == null) minF = packFormat;
  if (maxF == null) maxF = packFormat ?? minF;

  let supports: boolean | "unknown" = "unknown";
  if (minF != null && maxF != null) supports = minF <= TARGET_FORMAT && TARGET_FORMAT <= maxF;

  const overlays: ParsedMcmeta["overlays"] = [];
  const entries = json?.overlays?.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!e || typeof e.directory !== "string" || !/^[a-z0-9_.\-]+$/i.test(e.directory)) continue;
      let r = rangeOf(e.formats);
      if (!r) {
        const a = major(e.min_format), b = major(e.max_format);
        if (a != null && b != null) r = [a, b];
      }
      if (r) overlays.push({ directory: e.directory, min: r[0], max: r[1] });
    }
  }

  return {
    description: textComponentToString(pack.description ?? "").trim(),
    format: {
      packFormat,
      minFormat: minF,
      maxFormat: maxF,
      versionLabel: formatToVersionLabel(minF, maxF),
      supports12111: supports,
    },
    overlays,
    warnings,
  };
}
