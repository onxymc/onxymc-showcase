import { useEffect, useMemo, useRef, useState } from "react";
import type { Showcase } from "../core/showcase";
import { Btn, Field, Modal, Select, Slider, Toggle } from "../ui/controls";
import { exportGif, exportPng, exportVideo, PRESETS, videoSupport, type ExportSize } from "../render/exporter";
import { computeLayout } from "../render/showcaseRenderer";
import { saveBytes, revealInFolder } from "../platform";
import { useApp } from "../state/store";

type Fmt = "png" | "gif" | "video" | "project";

export function ExportDialog({ sc, onClose }: { sc: Showcase; onClose: () => void }) {
  const exportDir = useApp((s) => s.settings.exportDir);
  const [fmt, setFmt] = useState<Fmt>("png");
  const [preset, setPreset] = useState<ExportSize["preset"]>("native");
  const [scale, setScale] = useState(2);
  const [cw, setCw] = useState(1920);
  const [ch, setCh] = useState(1080);
  const [transparent, setTransparent] = useState(false);
  const [gifStep, setGifStep] = useState(1);
  const [fps, setFps] = useState(30);
  const [auto, setAuto] = useState(true);
  const [secs, setSecs] = useState(4);
  const [quality, setQuality] = useState(0.8);
  const [progress, setProgress] = useState<number | null>(null);
  const [vs, setVs] = useState<{ mp4: boolean; webm: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const layout = useMemo(() => computeLayout(sc), [sc]);
  useEffect(() => {
    videoSupport().then(setVs);
  }, []);

  const size: ExportSize = { preset, scale, width: cw, height: ch };
  const outW = preset === "native" ? Math.round(layout.width * scale) : preset === "custom" ? cw : PRESETS[preset][0];
  const outH = preset === "native" ? Math.round(layout.height * scale) : preset === "custom" ? ch : PRESETS[preset][1];
  const base = sc.name.replace(/[\\/:*?"<>|]/g, "_") || "showcase";

  const run = async () => {
    const st = useApp.getState();
    abort.current = new AbortController();
    setProgress(0);
    try {
      let bytes: Uint8Array, name: string, filters: { name: string; extensions: string[] }[];
      if (fmt === "png") {
        bytes = await exportPng(sc, size, transparent);
        name = `${base}${preset === "native" && scale > 1 ? `@${scale}x` : ""}${transparent ? "-transparent" : ""}.png`;
        filters = [{ name: "PNG image", extensions: ["png"] }];
      } else if (fmt === "gif") {
        bytes = await exportGif(sc, size, { ticksPerFrame: gifStep, durationTicks: auto ? "auto" : Math.round(secs * 20), transparent, onProgress: setProgress, signal: abort.current.signal });
        name = `${base}.gif`;
        filters = [{ name: "GIF animation", extensions: ["gif"] }];
      } else if (fmt === "video") {
        const container = vs?.mp4 ? "mp4" : "webm";
        bytes = await exportVideo(sc, size, { fps, durationTicks: auto ? "auto" : Math.round(secs * 20), container, quality, onProgress: setProgress, signal: abort.current.signal });
        name = `${base}.${container}`;
        filters = [{ name: container.toUpperCase() + " video", extensions: [container] }];
      } else {
        bytes = new TextEncoder().encode(JSON.stringify({ app: "onxymc-showcase", kind: "showcase-project", version: 1, showcase: sc }, null, 2));
        name = `${base}.onxyshowcase`;
        filters = [{ name: "OnxyMc showcase project", extensions: ["onxyshowcase"] }];
      }
      setProgress(1);
      const path = await saveBytes(name, bytes, filters, exportDir ?? undefined);
      if (path) {
        st.toast(`Exported ${name} (${(bytes.length / 1024).toFixed(0)} KB)`, "success");
        if (path.includes("/") || path.includes("\\")) revealInFolder(path).catch(() => {});
        onClose();
      }
    } catch (e: any) {
      st.toast(`Export failed: ${e?.message ?? e}`, "error");
    } finally {
      setProgress(null);
    }
  };

  const videoLabel = vs == null ? "Video (checking…)" : vs.mp4 ? "MP4 video" : vs.webm ? "WebM video (MP4 encoder unavailable)" : "Video (no encoder available)";
  return (
    <Modal
      title="Export showcase"
      onClose={() => (abort.current?.abort(), onClose())}
      footer={
        <>
          {progress != null && (
            <div className="grow progress" style={{ alignSelf: "center" }}>
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {progress != null ? <Btn onClick={() => abort.current?.abort()}>Cancel</Btn> : <Btn onClick={onClose}>Close</Btn>}
          <Btn kind="primary" icon="download" disabled={progress != null || (fmt === "video" && !vs?.mp4 && !vs?.webm)} onClick={run}>
            Export
          </Btn>
        </>
      }
    >
      <Field label="Format">
        <Select<Fmt>
          value={fmt}
          onChange={setFmt}
          options={[
            { value: "png", label: "PNG image" },
            { value: "gif", label: "GIF animation" },
            { value: "video", label: videoLabel },
            { value: "project", label: "Editable project file (.onxyshowcase)" },
          ]}
        />
      </Field>
      {fmt !== "project" && (
        <>
          <Field label="Resolution / aspect ratio">
            <Select<ExportSize["preset"]>
              value={preset}
              onChange={setPreset}
              options={[
                { value: "native", label: "Native layout size × scale" },
                ...(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => ({ value: k, label: PRESETS[k][2] })),
                { value: "custom", label: "Custom resolution" },
              ]}
            />
          </Field>
          {preset === "native" && <Slider label="Scale (high-resolution)" min={1} max={6} value={scale} onChange={setScale} fmt={(v) => `${v}×`} />}
          {preset === "custom" && (
            <div className="grid2">
              <Field label="Width">
                <input className="input" type="number" min={16} max={8192} value={cw} onChange={(e) => setCw(+e.target.value)} />
              </Field>
              <Field label="Height">
                <input className="input" type="number" min={16} max={8192} value={ch} onChange={(e) => setCh(+e.target.value)} />
              </Field>
            </div>
          )}
          <div className="small muted">
            Output: <b>{outW} × {outH}</b> px · textures are re-drawn at this resolution with nearest-neighbour pixels.
          </div>
        </>
      )}
      {(fmt === "png" || fmt === "gif") && <Toggle label={fmt === "gif" ? "Transparent background (1-bit alpha)" : "Transparent background"} value={transparent} onChange={setTransparent} />}
      {(fmt === "gif" || fmt === "video") && (
        <>
          {fmt === "gif" ? (
            <Field label="Frame rate (Minecraft animates at 20 ticks/s)">
              <Select value={String(gifStep)} onChange={(v) => setGifStep(+v)} options={[{ value: "1", label: "20 fps (every tick)" }, { value: "2", label: "10 fps" }, { value: "4", label: "5 fps" }]} />
            </Field>
          ) : (
            <>
              <Field label="Frame rate">
                <Select value={String(fps)} onChange={(v) => setFps(+v)} options={[{ value: "20", label: "20 fps (one frame per tick)" }, { value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }]} />
              </Field>
              <Slider label="Quality" min={0.1} max={1} step={0.05} value={quality} onChange={setQuality} fmt={(v) => `${Math.round(v * 100)}%`} />
            </>
          )}
          <Toggle label="Duration: one full animation loop (auto)" value={auto} onChange={setAuto} />
          {!auto && <Slider label="Duration" min={1} max={30} step={0.5} value={secs} onChange={setSecs} fmt={(v) => `${v}s`} />}
          <span className="tiny muted">Frames use the real .png.mcmeta timing (50 ms per tick); identical consecutive GIF frames are merged.</span>
        </>
      )}
      {fmt === "video" && vs && !vs.mp4 && !vs.webm && <div className="chip warn">This system has no compatible video encoder — use GIF instead.</div>}
    </Modal>
  );
}
