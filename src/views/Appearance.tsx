import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, ColorIn, Field, Slider, Toggle } from "../ui/controls";
import { THEMES, type ThemeColors, type ThemeId } from "../state/themes";

export function Appearance() {
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const c = s.customTheme;
  const setC = (p: Partial<ThemeColors>) => set({ theme: "custom", customTheme: { ...c, ...p } });
  const all: [ThemeId, string, ThemeColors][] = [...(Object.entries(THEMES) as [ThemeId, { name: string; colors: ThemeColors }][]).map(([id, t]) => [id, t.name, t.colors] as [ThemeId, string, ThemeColors]), ["custom", "Custom", c]];
  return (
    <>
      <TopBar title="Appearance" sub="Themes, accent colours and effects" />
      <div className="content col" style={{ gap: 16 }}>
        <div className="panel pad">
          <h3>Theme</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {all.map(([id, name, col]) => (
              <div key={id} className={`theme-swatch ${s.theme === id ? "on" : ""}`} onClick={() => set({ theme: id })} style={{ background: `radial-gradient(120px 60px at 80% 0%, ${col.accent}55, transparent), linear-gradient(160deg, ${col.panel}, ${col.bg})` }} data-theme={id}>
                <div style={{ position: "absolute", right: 10, top: 10, width: 14, height: 14, borderRadius: 4, background: col.accent, boxShadow: `0 0 12px ${col.glow}` }} />
                <span style={{ color: col.text }}>{name}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          <div className="panel pad col">
            <div className="row"><h3 style={{ margin: 0 }} className="grow">Custom theme editor</h3><Btn sm onClick={() => set({ theme: "custom", customTheme: { ...THEMES["onxy-red"].colors } })}>Start from Onxy Red</Btn></div>
            <div className="grid3">
              {([
                ["bg", "Background"], ["bg2", "Background 2"], ["panel", "Panels"], ["panelBorder", "Panel border"], ["accent", "Accent"], ["accent2", "Accent highlight"],
                ["button", "Buttons"], ["buttonText", "Button text"], ["glow", "Glow"], ["border", "Borders"], ["text", "Text"], ["textDim", "Dim text"], ["hover", "Hover"],
              ] as [keyof ThemeColors, string][]).map(([k, l]) => (
                <Field key={k} label={l}><ColorIn value={c[k] as string} onChange={(v) => setC({ [k]: v })} /></Field>
              ))}
            </div>
            <div className="grid2">
              <Slider label="Corner radius" min={0} max={22} value={c.radius} onChange={(v) => setC({ radius: v })} fmt={(v) => `${v}px`} />
              <Slider label="Panel opacity (transparency)" min={0.4} max={1} step={0.02} value={c.transparency} onChange={(v) => setC({ transparency: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Glow strength" min={0} max={1} step={0.05} value={c.glowStrength} onChange={(v) => setC({ glowStrength: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Animation intensity (hover/transition speed)" min={0} max={1} step={0.05} value={c.animationIntensity} onChange={(v) => setC({ animationIntensity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            </div>
            <Toggle label="Snowfall" value={c.snow} onChange={(v) => setC({ snow: v })} />
          </div>
          <div className="panel pad col sweep">
            <h3>Effects</h3>
            <Toggle label="Decorative effects (glows, gradients)" value={s.effects} onChange={(v) => set({ effects: v })} />
            <Toggle label="Glossy light sweep on panels" value={s.lightSweep} onChange={(v) => set({ lightSweep: v })} />
            <Toggle label="Animated background particles" value={s.backgroundFx} onChange={(v) => set({ backgroundFx: v })} />
            <Toggle label="Reduce motion" value={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
            <Toggle label="Pixel font for the interface" value={s.pixelUiFont} onChange={(v) => set({ pixelUiFont: v })} />
            <div className="hr" />
            <div className="row wrap">
              <Btn kind="primary">Primary</Btn>
              <Btn>Button</Btn>
              <span className="chip accent">Accent chip</span>
              <span className="chip ok">OK</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
