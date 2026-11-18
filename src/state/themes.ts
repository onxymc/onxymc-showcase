export type ThemeId = "onxy-red" | "blossom" | "violet" | "ghost" | "christmas" | "midnight" | "custom";

export interface ThemeColors {
  bg: string;
  bg2: string;
  panel: string;
  panelBorder: string;
  accent: string;
  accent2: string;
  button: string;
  buttonText: string;
  glow: string;
  border: string;
  text: string;
  textDim: string;
  hover: string;
  radius: number;
  transparency: number; // 0..1 panel alpha
  glowStrength: number; // 0..1
  animationIntensity: number; // 0..1
  snow: boolean;
}

const base = {
  bg: "#07070a", bg2: "#0e0e13", panel: "#14141b", panelBorder: "#24242e", button: "#1c1c25", buttonText: "#f2f2f5",
  border: "#2a2a35", text: "#f2f2f5", textDim: "#8c8c99", hover: "#22222c", radius: 12, transparency: 0.82, glowStrength: 0.55, animationIntensity: 0.7, snow: false,
};

export const THEMES: Record<Exclude<ThemeId, "custom">, { name: string; colors: ThemeColors }> = {
  "onxy-red": { name: "Onxy Red", colors: { ...base, accent: "#ff2d46", accent2: "#ff6b7d", glow: "#ff1f3d" } },
  blossom: { name: "Blossom Pink", colors: { ...base, accent: "#ff5fa8", accent2: "#ffa3cd", glow: "#ff4f9e" } },
  violet: { name: "Violet", colors: { ...base, accent: "#9b5cff", accent2: "#c4a1ff", glow: "#8b46ff" } },
  ghost: { name: "Ghost", colors: { ...base, bg: "#16171b", bg2: "#1c1d22", panel: "#22232a", panelBorder: "#34353e", border: "#3a3b45", hover: "#2c2d35", accent: "#e8eaf0", accent2: "#ffffff", glow: "#dfe3ea", buttonText: "#f5f6f8" } },
  christmas: { name: "Christmas", colors: { ...base, bg: "#12060a", bg2: "#1a0a0f", panel: "#221016", panelBorder: "#3a1a22", border: "#40202a", hover: "#2c141b", accent: "#e8394a", accent2: "#4fbf72", glow: "#ff4757", snow: true } },
  midnight: { name: "Midnight", colors: { ...base, bg: "#05060a", bg2: "#090b11", panel: "#0e1018", panelBorder: "#1a1d28", border: "#1f2230", accent: "#7aa2ff", accent2: "#a8c1ff", glow: "#5d8bff", glowStrength: 0.15 } },
};

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (h: string, a: number) => `rgba(${hexToRgb(h).join(",")},${a})`;

export function applyTheme(c: ThemeColors, opts: { effects: boolean; reduceMotion: boolean }) {
  const r = document.documentElement.style;
  const set = (k: string, v: string) => r.setProperty(k, v);
  set("--bg", c.bg);
  set("--bg2", c.bg2);
  set("--panel", rgba(c.panel, c.transparency));
  set("--panel-solid", c.panel);
  set("--panel-border", c.panelBorder);
  set("--accent", c.accent);
  set("--accent2", c.accent2);
  set("--accent-soft", rgba(c.accent, 0.14));
  set("--accent-line", rgba(c.accent, 0.45));
  set("--button", c.button);
  set("--button-text", c.buttonText);
  set("--glow", opts.effects ? rgba(c.glow, 0.5 * c.glowStrength) : "transparent");
  set("--glow-strong", opts.effects ? rgba(c.glow, 0.85 * c.glowStrength) : "transparent");
  set("--border", c.border);
  set("--text", c.text);
  set("--text-dim", c.textDim);
  set("--hover", c.hover);
  set("--radius", `${c.radius}px`);
  set("--radius-sm", `${Math.max(2, Math.round(c.radius * 0.6))}px`);
  const speed = opts.reduceMotion ? 0 : c.animationIntensity;
  set("--anim", speed === 0 ? "0ms" : `${Math.round(120 + 220 * speed)}ms`);
  document.documentElement.dataset.effects = opts.effects ? "on" : "off";
  document.documentElement.dataset.motion = opts.reduceMotion ? "reduced" : "full";
}
