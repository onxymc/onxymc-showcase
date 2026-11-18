// Global app state (zustand) with debounced, crash-safe persistence.
import { create } from "zustand";
import type { PackRecord } from "../core/types";
import { normalizeShowcase, type Showcase, type TemplateDef } from "../core/showcase";
import { THEMES, type ThemeColors, type ThemeId } from "./themes";
import { storeRead, storeWrite } from "../platform";

export type ViewId = "dashboard" | "library" | "creator" | "animations" | "models" | "skybox" | "install" | "community" | "appearance" | "settings";

export interface Settings {
  theme: ThemeId;
  customTheme: ThemeColors;
  minecraftDir: string | null;
  resourcepacksDir: string | null;
  importDir: string | null;
  exportDir: string | null;
  effects: boolean;
  lightSweep: boolean;
  backgroundFx: boolean;
  reduceMotion: boolean;
  animationsEnabled: boolean;
  animationSpeed: number;
  maxPreviewFps: number;
  pauseOffscreen: boolean;
  textureCacheMB: number;
  lowQualityPreviews: boolean;
  autoBackup: boolean;
  backupKeep: number;
  checkUpdates: boolean;
  libraryView: "grid" | "list";
  links: { discord: string; modrinth: string; curseforge: string; github: string; youtube: string; website: string };
  pixelUiFont: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "onxy-red",
  customTheme: { ...THEMES["onxy-red"].colors },
  minecraftDir: null,
  resourcepacksDir: null,
  importDir: null,
  exportDir: null,
  effects: true,
  lightSweep: true,
  backgroundFx: true,
  reduceMotion: false,
  animationsEnabled: true,
  animationSpeed: 1,
  maxPreviewFps: 20,
  pauseOffscreen: true,
  textureCacheMB: 256,
  lowQualityPreviews: false,
  autoBackup: true,
  backupKeep: 5,
  checkUpdates: false,
  libraryView: "grid",
  links: { discord: "https://discord.gg/8PUvTTUQZe/", modrinth: "", curseforge: "", github: "", youtube: "", website: "" },
  pixelUiFont: false,
};

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface State {
  ready: boolean;
  view: ViewId;
  settings: Settings;
  packs: PackRecord[];
  showcases: Showcase[];
  customTemplates: TemplateDef[];
  categories: string[];
  activeShowcaseId: string | null;
  focusPackId: string | null;
  toasts: Toast[];
  importing: { done: number; total: number; current: string } | null;
  setView(v: ViewId): void;
  setSettings(p: Partial<Settings>): void;
  upsertPack(p: PackRecord): void;
  updatePack(id: string, p: Partial<PackRecord>): void;
  removePack(id: string): void;
  reorderPacks(ids: string[]): void;
  upsertShowcase(s: Showcase): void;
  removeShowcase(id: string): void;
  setActiveShowcase(id: string | null): void;
  setFocusPack(id: string | null): void;
  addCustomTemplate(t: TemplateDef): void;
  removeCustomTemplate(id: string): void;
  setCategories(c: string[]): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setImporting(v: State["importing"]): void;
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  ready: false,
  view: "dashboard",
  settings: DEFAULT_SETTINGS,
  packs: [],
  showcases: [],
  customTemplates: [],
  categories: ["PvP", "Animated", "Skybox", "Variants", "Favorites"],
  activeShowcaseId: null,
  focusPackId: null,
  toasts: [],
  importing: null,
  setView: (view) => set({ view }),
  setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
  upsertPack: (p) => {
    const packs = get().packs.filter((x) => x.id !== p.id);
    set({ packs: [...packs, p].sort((a, b) => a.order - b.order) });
  },
  updatePack: (id, p) => set({ packs: get().packs.map((x) => (x.id === id ? { ...x, ...p } : x)) }),
  removePack: (id) => set({ packs: get().packs.filter((x) => x.id !== id) }),
  reorderPacks: (ids) => {
    const byId = new Map(get().packs.map((p) => [p.id, p]));
    set({ packs: ids.map((id, i) => ({ ...byId.get(id)!, order: i })).filter((p) => p.id) });
  },
  upsertShowcase: (s) => {
    const list = get().showcases;
    const i = list.findIndex((x) => x.id === s.id);
    const next = i >= 0 ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
    set({ showcases: next });
  },
  removeShowcase: (id) => set({ showcases: get().showcases.filter((s) => s.id !== id), activeShowcaseId: get().activeShowcaseId === id ? null : get().activeShowcaseId }),
  setActiveShowcase: (activeShowcaseId) => set({ activeShowcaseId }),
  setFocusPack: (focusPackId) => set({ focusPackId }),
  addCustomTemplate: (t) => set({ customTemplates: [...get().customTemplates.filter((x) => x.id !== t.id), t] }),
  removeCustomTemplate: (id) => set({ customTemplates: get().customTemplates.filter((x) => x.id !== id) }),
  setCategories: (categories) => set({ categories }),
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setImporting: (importing) => set({ importing }),
}));

// ---------------------------------------------------------------- persistence
const SCHEMA = 1;

async function readJson(name: string): Promise<any | null> {
  try {
    const t = await storeRead(name);
    return t ? JSON.parse(t) : null;
  } catch (e) {
    console.warn(`Could not read ${name}; starting fresh`, e);
    return null;
  }
}

export async function loadPersisted() {
  const [settings, library, showcases] = await Promise.all([readJson("settings"), readJson("library"), readJson("showcases")]);
  const s: Settings = { ...DEFAULT_SETTINGS, ...(settings?.data ?? {}) };
  s.links = { ...DEFAULT_SETTINGS.links, ...(settings?.data?.links ?? {}) };
  s.customTheme = { ...DEFAULT_SETTINGS.customTheme, ...(settings?.data?.customTheme ?? {}) };
  const packs: PackRecord[] = Array.isArray(library?.data?.packs) ? library.data.packs.filter((p: any) => p && typeof p.id === "string") : [];
  const list: Showcase[] = Array.isArray(showcases?.data?.showcases) ? showcases.data.showcases.map(normalizeShowcase).filter(Boolean) : [];
  useApp.setState({
    settings: s,
    packs: packs.sort((a, b) => a.order - b.order),
    showcases: list,
    customTemplates: Array.isArray(showcases?.data?.templates) ? showcases.data.templates : [],
    categories: Array.isArray(library?.data?.categories) ? library.data.categories : useApp.getState().categories,
    ready: true,
  });
}

const timers: Record<string, number> = {};
function debounced(name: string, build: () => unknown, ms = 400) {
  clearTimeout(timers[name]);
  timers[name] = window.setTimeout(() => {
    storeWrite(name, JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), data: build() })).catch((e) => {
      console.error("save failed", e);
      useApp.getState().toast(`Could not save ${name}: ${e}`, "error");
    });
  }, ms);
}

export function startPersistence() {
  useApp.subscribe((st, prev) => {
    if (!st.ready) return;
    if (st.settings !== prev.settings) debounced("settings", () => st.settings);
    if (st.packs !== prev.packs || st.categories !== prev.categories) debounced("library", () => ({ packs: useApp.getState().packs, categories: useApp.getState().categories }));
    if (st.showcases !== prev.showcases || st.customTemplates !== prev.customTemplates) {
      debounced("showcases", () => ({ showcases: useApp.getState().showcases, templates: useApp.getState().customTemplates }), 600);
      if (st.settings.autoBackup) scheduleBackup();
    }
  });
}

let backupTimer = 0;
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = window.setTimeout(async () => {
    const st = useApp.getState();
    const slot = Math.floor(Date.now() / 600000) % Math.max(1, st.settings.backupKeep); // rotating 10-minute slots
    await storeWrite(`backup-showcases-${slot}`, JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), data: { showcases: st.showcases, templates: st.customTemplates } })).catch(() => {});
  }, 5000);
}

export function themeColors(s: Settings): ThemeColors {
  return s.theme === "custom" ? s.customTheme : THEMES[s.theme].colors;
}
