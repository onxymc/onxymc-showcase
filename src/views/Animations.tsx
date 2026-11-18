import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, Select, Slider, Toggle } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { TextureView } from "../ui/TextureView";
import { getTexture, type LoadedTexture } from "../core/packAccess";
import { sampleTimeline, TICK_MS } from "../core/animation";
import { subscribeClock } from "../render/clock";

export function Animations() {
  const packs = useApp((s) => s.packs);
  const withAnim = packs.filter((p) => p.scan.animatedTextures.length);
  const [packId, setPackId] = useState(withAnim[0]?.id ?? "");
  const pack = packs.find((p) => p.id === packId);
  const [path, setPath] = useState<string>("");
  const [q, setQ] = useState("");
  useEffect(() => setPath(pack?.scan.animatedTextures[0] ?? ""), [packId]);
  const list = useMemo(() => (pack?.scan.animatedTextures ?? []).filter((p) => p.toLowerCase().includes(q.toLowerCase())), [pack, q]);

  return (
    <>
      <TopBar title="Animated Texture Preview" sub="Real .png.mcmeta playback — frame times, custom frame order and interpolation">
        <div style={{ width: 260 }}>
          <Select value={packId} onChange={setPackId} options={withAnim.length ? withAnim.map((p) => ({ value: p.id, label: `${p.name} (${p.scan.animatedTextures.length})` })) : [{ value: "", label: "No packs with animations" }]} />
        </div>
      </TopBar>
      <div className="content">
        {!withAnim.length ? (
          <div className="panel empty">
            <Icon name="film" size={40} />
            <h2>No animated textures found</h2>
            <div>Packs with .png.mcmeta animation files will appear here after import.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
            <div className="panel pad col" style={{ maxHeight: "calc(100vh - 170px)", overflow: "hidden" }}>
              <div className="search">
                <Icon name="search" size={16} />
                <input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="dnd-list" style={{ overflow: "auto" }}>
                {list.map((p) => (
                  <div key={p} className={`dnd-item ${p === path ? "sel" : ""}`} onClick={() => setPath(p)} style={{ cursor: "pointer" }} title={p}>
                    <TextureView packId={packId} path={p} size={28} />
                    <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.split("/").slice(-2).join("/")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {path && <Player key={packId + path} packId={packId} path={path} />}
          </div>
        )}
      </div>
    </>
  );
}

export function Player({ packId, path }: { packId: string; path: string }) {
  const [tex, setTex] = useState<LoadedTexture | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(16);
  const [tick, setTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<{ g: number; t: number } | null>(null);

  useEffect(() => {
    getTexture(packId, path)
      .then((t) => {
        setTex(t);
        if (t?.animError) setErr(t.animError);
      })
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [packId, path]);

  const tl = tex?.timeline ?? null;
  useEffect(() => {
    if (!playing || !tl) return;
    base.current = null;
    return subscribeClock((g) => {
      if (!base.current) base.current = { g, t: tick };
      let t = base.current.t + (g - base.current.g) * speed;
      if (!loop && t >= tl.totalTicks - 1) {
        t = tl.totalTicks - 1;
        setPlaying(false);
      }
      setTick(t);
    });
  }, [playing, speed, loop, tl]);

  const smp = tl ? sampleTimeline(tl, tick, loop) : null;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !tex) return;
    const fw = tl?.frameW ?? tex.width, fh = tl?.frameH ?? tex.height;
    c.width = fw * zoom;
    c.height = fh * zoom;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!tl || !smp) return ctx.drawImage(tex.bitmap, 0, 0, fw, fh, 0, 0, c.width, c.height);
    const src = (i: number) => [(i % tl.cols) * fw, Math.floor(i / tl.cols) * fh] as const;
    const [x, y] = src(smp.index);
    ctx.drawImage(tex.bitmap, x, y, fw, fh, 0, 0, c.width, c.height);
    if (smp.mix > 0) {
      const [nx, ny] = src(smp.nextIndex);
      ctx.globalAlpha = smp.mix;
      ctx.drawImage(tex.bitmap, nx, ny, fw, fh, 0, 0, c.width, c.height);
      ctx.globalAlpha = 1;
    }
  }, [tex, smp?.key, smp?.mix, zoom]);

  const stepSeq = (d: number) => {
    if (!tl || !smp) return;
    setPlaying(false);
    const n = tl.frames.length;
    const seq = (smp.seq + d + n) % n;
    setTick(tl.starts[seq]);
  };

  if (err && !tl) return <div className="panel pad chip warn">{err}</div>;
  if (!tex) return <div className="panel pad muted">Loading…</div>;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="anim-stage" style={{ minHeight: 400 }}>
        <canvas ref={canvas} className="pixel" style={{ maxWidth: "100%", maxHeight: 520 }} />
        {err && <div className="overlay-note">⚠ {err} — Minecraft would also reject this animation.</div>}
      </div>
      <div className="panel pad col">
        <div className="row wrap">
          <Btn iconOnly icon="stepback" title="Previous frame" onClick={() => stepSeq(-1)} />
          <Btn kind="primary" iconOnly icon={playing ? "pause" : "play"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)} />
          <Btn iconOnly icon="step" title="Next frame" onClick={() => stepSeq(1)} />
          <Btn iconOnly icon="restart" title="Restart" onClick={() => { setTick(0); base.current = null; setPlaying(true); }} />
          <Toggle label="Loop" value={loop} onChange={setLoop} />
          <div className="grow" />
          {smp && tl && (
            <span className="small mono">
              frame {smp.seq + 1}/{tl.frames.length} · sheet #{smp.index} · tick {Math.floor(tick) % tl.totalTicks}/{tl.totalTicks}
              {smp.mix > 0 && ` · blend ${Math.round(smp.mix * 100)}%`}
            </span>
          )}
        </div>
        <div className="grid2">
          <Slider label="Speed" min={0.1} max={4} step={0.1} value={speed} onChange={setSpeed} fmt={(v) => `${v.toFixed(1)}×`} />
          <Slider label="Zoom (pixel-perfect)" min={1} max={32} value={zoom} onChange={setZoom} fmt={(v) => `${v}×`} />
        </div>
        {tl && (
          <>
            <div className="framestrip">
              {tl.frames.map((f, i) => (
                <button key={i} className={smp?.seq === i ? "on" : ""} onClick={() => { setPlaying(false); setTick(tl.starts[i]); }} title={`Sheet frame ${f.index}, ${f.time} ticks`}>
                  <FrameThumb tex={tex} index={f.index} />
                  {f.time}t
                </button>
              ))}
            </div>
            <div className="row wrap small muted" style={{ gap: 14 }}>
              <span>Frame size {tl.frameW}×{tl.frameH}</span>
              <span>{tl.sheetFrames} frames in sheet</span>
              <span>{tl.frames.length} in sequence</span>
              <span>Loop {tl.totalTicks} ticks = {((tl.totalTicks * TICK_MS) / 1000).toFixed(2)} s</span>
              <span>Interpolate: {tl.interpolate ? "yes" : "no"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FrameThumb({ tex, index }: { tex: LoadedTexture; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const tl = tex.timeline!;
    const c = ref.current!;
    c.width = tl.frameW;
    c.height = tl.frameH;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(tex.bitmap, (index % tl.cols) * tl.frameW, Math.floor(index / tl.cols) * tl.frameH, tl.frameW, tl.frameH, 0, 0, tl.frameW, tl.frameH);
  }, [tex, index]);
  return <canvas ref={ref} />;
}
