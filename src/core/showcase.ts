// Showcase document model + built-in templates.
import { DEFAULT_COLUMNS, SKY_COLUMN } from "./catalog";

export type FontId = "inter" | "silkscreen" | "press-start" | "pixelify" | "mono";
export const FONTS: Record<FontId, { label: string; css: string; pixel: boolean }> = {
  inter: { label: "Inter (clean)", css: "'Inter Variable', 'Inter', system-ui, sans-serif", pixel: false },
  silkscreen: { label: "Silkscreen (pixel)", css: "'Silkscreen', monospace", pixel: true },
  "press-start": { label: "Press Start 2P (pixel)", css: "'Press Start 2P', monospace", pixel: true },
  pixelify: { label: "Pixelify Sans (pixel)", css: "'Pixelify Sans', monospace", pixel: true },
  mono: { label: "Monospace", css: "ui-monospace, 'Cascadia Mono', Consolas, monospace", pixel: false },
};

export interface ShowcaseRow {
  id: string;
  packId: string | null;
  name: string;
  color: string;
  badge: string;
  /** column id → custom texture path inside this row's pack */
  overrides: Record<string, string>;
  hidden: boolean;
}

export interface ShowcaseColumn {
  id: string;
  key: string;
  label: string;
}

export interface ShowcaseStyle {
  layout: "rows" | "grid";
  gridColumns: number;
  background: string;
  backgroundImage: string | null;
  backgroundImageOpacity: number;
  backgroundOpacity: number;
  titleFont: FontId;
  labelFont: FontId;
  titleSize: number;
  titleColor: string;
  subtitleColor: string;
  cornerColor: string;
  labelSize: number;
  nameColorMode: "row" | "fixed";
  nameColor: string;
  hexColor: string;
  hexSize: number;
  cellSize: number;
  itemScale: number;
  colGap: number;
  rowGap: number;
  rowHeightExtra: number;
  padding: number;
  labelWidth: number;
  labelWidthAuto: boolean;
  cellBg: string;
  cellBorderColor: string;
  cellBorderWidth: number;
  cellRadius: number;
  glow: number;
  glowMode: "row" | "fixed";
  glowColor: string;
  showGrid: boolean;
  rowStripe: boolean;
  rowStripeColor: string;
  rowRadius: number;
  showSwatch: boolean;
  swatchSize: number;
  showHex: boolean;
  showColumnHeaders: boolean;
  headerColor: string;
  showVersion: boolean;
  versionText: string;
  showDescription: boolean;
  description: string;
  skyWidthCells: number;
  skyTime: number;
  animSpeed: number;
  pixelText: boolean;
}

export interface Showcase {
  id: string;
  name: string;
  templateId: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  subtitle: string;
  cornerText: string;
  cornerSubText: string;
  columns: ShowcaseColumn[];
  rows: ShowcaseRow[];
  style: ShowcaseStyle;
  fallbackPackId: string | null;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const BASE_STYLE: ShowcaseStyle = {
  layout: "rows",
  gridColumns: 6,
  background: "#0b0b0f",
  backgroundImage: null,
  backgroundImageOpacity: 0.35,
  backgroundOpacity: 1,
  titleFont: "silkscreen",
  labelFont: "silkscreen",
  titleSize: 20,
  titleColor: "#ffffff",
  subtitleColor: "#9b9ba6",
  cornerColor: "#f5d76e",
  labelSize: 16,
  nameColorMode: "fixed",
  nameColor: "#ffffff",
  hexColor: "#8d8d97",
  hexSize: 13,
  cellSize: 64,
  itemScale: 0.75,
  colGap: 12,
  rowGap: 12,
  rowHeightExtra: 0,
  padding: 20,
  labelWidth: 260,
  labelWidthAuto: true,
  cellBg: "#0d0d12",
  cellBorderColor: "#3a3a44",
  cellBorderWidth: 2,
  cellRadius: 0,
  glow: 0,
  glowMode: "row",
  glowColor: "#ff2d46",
  showGrid: true,
  rowStripe: false,
  rowStripeColor: "#16161c",
  rowRadius: 0,
  showSwatch: true,
  swatchSize: 32,
  showHex: true,
  showColumnHeaders: false,
  headerColor: "#9b9ba6",
  showVersion: false,
  versionText: "1.21.11",
  showDescription: false,
  description: "",
  skyWidthCells: 2.6,
  skyTime: 6000,
  animSpeed: 1,
  pixelText: true,
};

export interface TemplateDef {
  id: string;
  name: string;
  blurb: string;
  style: Partial<ShowcaseStyle>;
  columns?: string[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "kino-classic",
    name: "Classic Kino-style",
    blurb: "Pixel labels, colour swatch + hex, bordered square cells.",
    style: {},
    columns: ["netherite_helmet", "netherite_chestplate", "netherite_sword", "netherite_axe", "mace", "golden_apple", "ender_pearl", "elytra", "totem_of_undying", "end_crystal", "particle_sweep", "heart"],
  },
  {
    id: "modern-dark",
    name: "Modern Dark",
    blurb: "Coloured pack names, striped rows, sky column — the all-packs look.",
    style: {
      titleFont: "inter", labelFont: "inter", titleSize: 26, labelSize: 20, nameColorMode: "row", showSwatch: false, showHex: false,
      showGrid: false, rowStripe: true, rowStripeColor: "#1a1a22", background: "#121218", cellBg: "transparent", cellSize: 56, itemScale: 1,
      colGap: 6, rowGap: 6, labelWidth: 190, rowRadius: 4, pixelText: false, showVersion: true,
    },
    columns: DEFAULT_COLUMNS,
  },
  {
    id: "compact-pvp",
    name: "Compact PvP",
    blurb: "Tight grid of the PvP essentials.",
    style: { cellSize: 44, colGap: 6, rowGap: 6, labelWidth: 170, labelSize: 13, hexSize: 10, swatchSize: 22, padding: 14, titleSize: 15 },
    columns: ["netherite_sword", "netherite_axe", "mace", "netherite_chestplate", "totem_of_undying", "ender_pearl", "golden_apple", "end_crystal", "respawn_anchor", "shield", "heart"],
  },
  {
    id: "full-compare",
    name: "Full Pack Comparison",
    blurb: "Every major item, ideal for many variants side by side.",
    style: { cellSize: 52, colGap: 6, rowGap: 6, rowStripe: true, rowStripeColor: "#121218", showColumnHeaders: true, labelWidth: 200, labelSize: 14 },
    columns: [
      "netherite_sword", "netherite_axe", "netherite_spear", "mace", "netherite_pickaxe", "netherite_helmet", "netherite_chestplate", "netherite_leggings", "netherite_boots",
      "diamond_sword", "diamond_helmet", "diamond_chestplate", "elytra", "shield", "totem_of_undying", "ender_pearl", "golden_apple", "enchanted_golden_apple", "end_crystal", "heart", SKY_COLUMN,
    ],
  },
  {
    id: "animated",
    name: "Animated Items",
    blurb: "Large cells with glow so animated textures shine.",
    style: { cellSize: 88, itemScale: 0.8, glow: 0.6, cellRadius: 10, cellBorderWidth: 1, cellBorderColor: "#2c2c36", titleFont: "pixelify", labelFont: "pixelify" },
    columns: ["netherite_sword", "netherite_axe", "mace", "totem_of_undying", "ender_pearl", "golden_apple"],
  },
  {
    id: "custom-grid",
    name: "Custom Grid",
    blurb: "Each pack shown as its own grid block of items.",
    style: { layout: "grid", gridColumns: 6, cellSize: 60, labelWidth: 0, rowGap: 28 },
    columns: DEFAULT_COLUMNS.filter((c) => c !== SKY_COLUMN),
  },
  {
    id: "minimal",
    name: "Minimal",
    blurb: "No borders, no swatches — just the textures.",
    style: { showGrid: false, showSwatch: false, showHex: false, cellBg: "transparent", labelFont: "inter", titleFont: "inter", pixelText: false, labelSize: 15, labelWidth: 150 },
    columns: ["netherite_sword", "netherite_axe", "mace", "netherite_chestplate", "totem_of_undying", "ender_pearl", "golden_apple"],
  },
  {
    id: "skybox",
    name: "Skybox & Environment",
    blurb: "Big sky panorama per pack with a few key items.",
    style: { skyWidthCells: 6, cellSize: 72, nameColorMode: "row", showSwatch: false, labelFont: "inter", titleFont: "inter", pixelText: false, labelSize: 20 },
    columns: ["netherite_sword", "totem_of_undying", "heart", SKY_COLUMN],
  },
];

export function makeColumns(keys: string[]): ShowcaseColumn[] {
  return keys.map((key) => ({ id: uid(), key, label: "" }));
}

const VARIANT_COLORS = ["#8A0C05", "#5F173A", "#35105E", "#19191E", "#B8860B", "#A7A9AC", "#1E5AA8", "#2E7D32"];

export function newShowcase(name: string, templateId: string, packIds: { id: string; name: string; color?: string }[]): Showcase {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const now = Date.now();
  return {
    id: uid(),
    name,
    templateId: t.id,
    createdAt: now,
    updatedAt: now,
    title: name,
    subtitle: "",
    cornerText: "",
    cornerSubText: "",
    columns: makeColumns(t.columns ?? DEFAULT_COLUMNS),
    rows: packIds.map((p, i) => ({ id: uid(), packId: p.id, name: p.name, color: p.color ?? VARIANT_COLORS[i % VARIANT_COLORS.length], badge: "", overrides: {}, hidden: false })),
    style: { ...BASE_STYLE, ...t.style },
    fallbackPackId: null,
  };
}

export function applyTemplate(s: Showcase, t: TemplateDef, replaceColumns: boolean): Showcase {
  return {
    ...s,
    templateId: t.id,
    style: { ...BASE_STYLE, ...t.style, backgroundImage: s.style.backgroundImage },
    columns: replaceColumns && t.columns ? makeColumns(t.columns) : s.columns,
  };
}

/** Defensive normalisation for projects loaded from disk (older or hand-edited files). */
export function normalizeShowcase(x: any): Showcase | null {
  if (!x || typeof x !== "object" || typeof x.id !== "string") return null;
  const str = (v: any, d = "") => (typeof v === "string" ? v : d);
  return {
    id: x.id,
    name: str(x.name, "Untitled"),
    templateId: str(x.templateId, "kino-classic"),
    createdAt: Number(x.createdAt) || Date.now(),
    updatedAt: Number(x.updatedAt) || Date.now(),
    title: str(x.title),
    subtitle: str(x.subtitle),
    cornerText: str(x.cornerText),
    cornerSubText: str(x.cornerSubText),
    columns: Array.isArray(x.columns) ? x.columns.filter((c: any) => c && typeof c.key === "string").map((c: any) => ({ id: str(c.id, uid()), key: c.key, label: str(c.label) })) : [],
    rows: Array.isArray(x.rows)
      ? x.rows.filter((r: any) => r && typeof r === "object").map((r: any) => ({
          id: str(r.id, uid()), packId: typeof r.packId === "string" ? r.packId : null, name: str(r.name), color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#888888",
          badge: str(r.badge), overrides: r.overrides && typeof r.overrides === "object" ? r.overrides : {}, hidden: !!r.hidden,
        }))
      : [],
    style: { ...BASE_STYLE, ...(x.style && typeof x.style === "object" ? x.style : {}) },
    fallbackPackId: typeof x.fallbackPackId === "string" ? x.fallbackPackId : null,
  };
}
