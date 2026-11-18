import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, Field, Select, Slider, Toggle } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { getPackView, getTexture } from "../core/packAccess";
import { loadSkyLayers, fadeAlpha, type SkyLayerDef } from "../core/sky";
import { bitmapToImageData, renderSky, type SkySource } from "../render/skyRender";
import { ticksToClock } from "./Creator";

export default function Skybox() {
  const packs = useApp((s) => s.packs);
  const skyPacks = packs.filter((p) => p.scan.skyLayers.length);
  const [packId, setPackId] = useState(skyPacks[0]?.id ?? "");
  const [dim, setDim] = useState("world0");
  const [sources, setSources] = useState<SkySource[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [time, setTime] = useState(6000);
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(40);
  const [rain, setRain] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(10);
  const [fov, setFov] = useState(75);
  const [mode, setMode] = useState<"perspective" | "panorama">("perspective");
  const [vanilla, setVanilla] = useState(true);
  const [quality, setQuality] = useState(1);
  const [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [interacting, setInteracting] = useState(false);
  const pack = packs.find((p) => p.id === packId);
  const dims = useMemo(() => [...new Set((pack?.scan.skyLayers ?? []).map((l) => l.match(/sky\/(world-?\d+)\//)?.[1]).filter(Boolean) as string[])], [pack]);

  useEffect(() => {
    if (dims.length && !dims.includes(dim)) setDim(dims[0]);
  }, [dims]);

  useEffect(() => {
    if (!packId) return;
    setLoading(true);
    (async () => {
      const v = await getPackView(packId);
      const layers = await loadSkyLayers(v, dim);
      const out: SkySource[] = [];
      for (const l of layers) {
        const t = await getTexture(packId, l.texturePath).catch(() => null);
        if (t) out.push({ layer: l, image: bitmapToImageData(t.bitmap, 1536) });
      }
      setSources(out);
      setDisabled(new Set());
    })().finally(() => setLoading(false));
  }, [packId, dim]);

  // advance time of day
  useEffect(() => {
    if (!running) return;
    let raf = 0, last = performance.now();
    const f = (now: number) => {
      raf = requestAnimationFrame(f);
      const dt = now - last;
      if (dt < 50) return;
      last = now;
      setTime((t) => (t + rate * (dt / 50)) % 24000);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [running, rate]);

  // render (lower resolution while dragging / time-lapse for responsiveness)
  useEffect(() => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const raf = requestAnimationFrame(() => {
      const cssW = w.clientWidth, cssH = mode === "panorama" ? Math.round(cssW / 4) : Math.round(cssW * 0.5);
      const k = (interacting || running ? 0.45 : 0.9) * quality;
      const W = Math.max(64, Math.round(cssW * k)), H = Math.max(32, Math.round(cssH * k));
      c.width = W;
      c.height = H;
      c.style.height = `${cssH}px`;
      const active = sources.filter((s) => !disabled.has(s.layer.propertiesPath));
      const img = renderSky(active, { dayTime: time, yaw, pitch, fov: mode === "panorama" ? 100 : fov, mode, rain, showVanillaSky: vanilla }, W, H);
      c.getContext("2d")!.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [sources, disabled, time, yaw, pitch, fov, mode, rain, vanilla, quality, interacting, running]);

  const layerInfo = (l: SkyLayerDef) => {
    const a = fadeAlpha(l.fade, time);
    return `${Math.round(a * 100)}%`;
  };

  return (
    <>
      <TopBar title="Skybox Preview" sub="Skyboxify / OptiFine custom skies (optifine/sky/worldN/skyN.properties)">
        <div style={{ width: 240 }}>
          <Select value={packId} onChange={setPackId} options={skyPacks.length ? skyPacks.map((p) => ({ value: p.id, label: p.name })) : [{ value: "", label: "No packs with custom skies" }]} />
        </div>
      </TopBar>
      <div className="content">
        {!skyPacks.length ? (
          <div className="panel empty">
            <Icon name="sky" size={40} />
            <h2>No Skyboxify skies found</h2>
            <div>Packs with assets/minecraft/optifine/sky/world0/sky*.properties appear here.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
            <div className="col" style={{ gap: 12 }}>
              <div
                ref={wrap}
                className="viewport3d"
                style={{ minHeight: 0, cursor: drag.current ? "grabbing" : "grab" }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
                  setInteracting(true);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  setYaw((d.yaw - (e.clientX - d.x) * 0.25 + 360) % 360);
                  setPitch(Math.max(-89, Math.min(89, d.pitch + (e.clientY - d.y) * 0.25)));
                }}
                onPointerUp={() => {
                  drag.current = null;
                  setInteracting(false);
                }}
                onWheel={(e) => setFov((f) => Math.max(20, Math.min(110, f + Math.sign(e.deltaY) * 4)))}
              >
                <canvas ref={canvas} style={{ width: "100%", imageRendering: "auto" }} />
                {loading && <div className="overlay-note">Loading sky layers…</div>}
              </div>
              <div className="panel pad col">
                <div className="row">
                  <Btn kind="primary" iconOnly icon={running ? "pause" : "play"} title="Time-lapse" onClick={() => setRunning(!running)} />
                  <div className="grow">
                    <Slider label={`Time of day — ${ticksToClock(time)} (tick ${Math.round(time)})`} min={0} max={23999} step={10} value={Math.round(time)} onChange={setTime} />
                  </div>
                </div>
                <div className="row wrap">
                  {[["Sunrise", 23000, "sun"], ["Day", 6000, "sun"], ["Sunset", 12000, "sun"], ["Night", 18000, "moon"]].map(([l, t, i]) => (
                    <Btn key={l as string} sm icon={i as string} onClick={() => setTime(t as number)}>{l as string}</Btn>
                  ))}
                  <div className="grow" />
                  <div style={{ width: 220 }}>
                    <Slider label="Time-lapse speed" min={5} max={400} step={5} value={rate} onChange={setRate} fmt={(v) => `${v} ticks/tick`} />
                  </div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="panel pad col">
                {dims.length > 1 && (
                  <Field label="Dimension">
                    <Select value={dim} onChange={setDim} options={dims.map((d) => ({ value: d, label: d === "world0" ? "Overworld (world0)" : d === "world-1" ? "Nether (world-1)" : d === "world1" ? "The End (world1)" : d }))} />
                  </Field>
                )}
                <Field label="Projection">
                  <Select value={mode} onChange={(v) => setMode(v as any)} options={[{ value: "perspective", label: "Camera (drag to look)" }, { value: "panorama", label: "360° panorama strip" }]} />
                </Field>
                <Slider label="Field of view" min={20} max={110} value={fov} onChange={setFov} fmt={(v) => `${v}°`} />
                <Slider label="Rain strength" min={0} max={1} step={0.05} value={rain} onChange={setRain} fmt={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Render quality" min={0.4} max={1.5} step={0.1} value={quality} onChange={setQuality} fmt={(v) => `${Math.round(v * 100)}%`} />
                <Toggle label="Vanilla sky colour underneath" value={vanilla} onChange={setVanilla} />
                <Btn sm icon="restart" onClick={() => { setYaw(0); setPitch(10); setFov(75); }}>Reset camera</Btn>
              </div>
              <div className="panel pad col">
                <h3>Layers (render order)</h3>
                {sources.map((s) => (
                  <div key={s.layer.propertiesPath} className="col" style={{ gap: 4, paddingBottom: 8, borderBottom: "1px solid var(--panel-border)" }}>
                    <div className="row">
                      <Toggle label={<b className="small">{s.layer.propertiesPath.split("/").pop()}</b>} value={!disabled.has(s.layer.propertiesPath)} onChange={(v) => { const n = new Set(disabled); v ? n.delete(s.layer.propertiesPath) : n.add(s.layer.propertiesPath); setDisabled(n); }} />
                      <div className="grow" />
                      <span className="chip">{layerInfo(s.layer)}</span>
                    </div>
                    <div className="tiny muted">
                      blend <b>{s.layer.blend}</b> · {s.layer.fade.alwaysOn ? "always visible" : `fade ${ticksToClock(s.layer.fade.startIn)}→${ticksToClock(s.layer.fade.endIn)}, out ${ticksToClock(s.layer.fade.startOut)}→${ticksToClock(s.layer.fade.endOut)}`} · {s.layer.rotate ? `rotates ×${s.layer.speed}` : "static"} · weather {s.layer.weather.join("/")}
                    </div>
                    {(s.layer.biomes || s.layer.heights || s.layer.days) && <div className="tiny" style={{ color: "#f2c56b" }}>Conditions not simulated: {[s.layer.biomes && "biomes", s.layer.heights && "heights", s.layer.days && "days"].filter(Boolean).join(", ")}</div>}
                    {s.layer.warnings.map((w, i) => <div key={i} className="tiny" style={{ color: "#f2c56b" }}>{w}</div>)}
                  </div>
                ))}
                <span className="tiny muted">
                  Faces, fades, blend equations and rotation follow Skyboxify's source. Not previewed: the sun, moon and stars, sunrise fog colour, and biome/height/day conditions (all layers are shown as if their conditions are met).
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
