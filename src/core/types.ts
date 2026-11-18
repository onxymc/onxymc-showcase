// Shared domain types for OnxyMc Texture Pack Showcase.

export type PackSourceKind = "zip" | "folder" | "blob";

export interface PackRecord {
  id: string;
  /** Display name — editable without touching the original pack. */
  name: string;
  /** Name read from the pack itself (file/folder name). */
  originalName: string;
  description: string;
  /** Description from pack.mcmeta, kept separately so edits never touch the pack. */
  packDescription: string;
  author: string;
  category: string;
  tags: string[];
  favorite: boolean;
  featured: boolean;
  order: number;
  sourceKind: PackSourceKind;
  /** Absolute path to the original zip/folder (desktop). For browser mode this is a blob-store key. */
  sourcePath: string;
  sourceSize: number;
  sourceModified: number;
  addedAt: number;
  lastViewedAt: number;
  /** Data URL of pack.png (downscaled) or null. */
  iconDataUrl: string | null;
  customThumbnail: string | null;
  /** Data URL of an auto-generated preview strip. */
  previewDataUrl: string | null;
  format: PackFormatInfo;
  scan: PackScanSummary;
  links: PackLinks;
  installedAs: string | null;
  /** Dominant texture colour, used as the default variant colour. */
  accentColor?: string;
}

export interface PackLinks {
  download?: string;
  modrinth?: string;
  curseforge?: string;
  github?: string;
  youtube?: string;
  discord?: string;
}

export interface PackFormatInfo {
  packFormat: number | null;
  minFormat: number | null;
  maxFormat: number | null;
  /** Human-readable version range, e.g. "1.21.11" or "1.21.4 – 1.21.11". */
  versionLabel: string;
  supports12111: boolean | "unknown";
}

export interface PackScanSummary {
  textureCount: number;
  itemTextures: number;
  blockTextures: number;
  animatedTextures: string[];
  hasCustomItemModels: boolean;
  customItemModelCount: number;
  hasItemDefinitions: boolean;
  skyLayers: string[];
  hasCIT: boolean;
  warnings: string[];
  /** Root prefix inside the zip (packs zipped with an extra top folder). */
  rootPrefix: string;
}

export interface AnimationMeta {
  frametime: number;
  interpolate: boolean;
  frames: { index: number; time: number }[] | null;
  width: number | null;
  height: number | null;
}

export type ResolvedTexture = {
  path: string;
  /** How the texture was found. */
  via: "item-definition" | "model" | "direct" | "custom" | "fallback";
  modelPath?: string;
  is3DModel?: boolean;
};
