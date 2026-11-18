// Live showcase preview. The static parts are painted once into an offscreen
// layer; each tick only the animated cells are repainted (copy background, draw frame).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Showcase } from "../core/showcase";
import { computeLayout, drawShowcase, drawTexture, ensureFonts, type CellBox, type Layout, type TexSource } from "../render/showcaseRenderer";
import { subscribeClock, currentTick } from "../render/clock";
import { useApp } from "../state/store";

export type Selection = { type: "row"; rowId: string } | { type: "col"; colId: string } | { type: "cell"; rowId: string; colId: string } | null;

export function useBackgroundImage(dataUrl: string | null) {
  const [img, setImg] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (!dataUrl) return setImg(null);
    let off = false;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((b) => !off && setImg(b))
      .catch(() => setImg(null));
    return () => {
      off = true;
    };
  }, [dataUrl]);
  return img;
}

export function ShowcaseCanvas(p: { sc: Showcase; src: TexSource; version: number; zoom: number; playing: boolean; selection: Selection; onSelect: (s: Selection) => void; onLayout?: (l: Layout) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<OffscreenCanvas | null>(null);
  const [visible, setVisible] = useState(true);
  const [fontsReady, setFontsReady] = useState(0);
  const animOn = useApp((s) => s.settings.animationsEnabled);
  const pauseOff = useApp((s) => s.settings.pauseOffscreen);
  const [fontsLoaded, setFontsLoaded] = useState(0);
  const layout = useMemo(() => computeLayout(p.sc), [p.sc, fontsLoaded]);
  const bg = useBackgroundImage(p.sc.style.backgroundImage);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = p.zoom * dpr;

  useEffect(() => {
    ensureFonts(p.sc).then(() => {
      setFontsReady((n) => n + 1);
      setFontsLoaded((n) => n + 1);
    });
  }, [p.sc.style.titleFont, p.sc.style.labelFont]);
  useEffect(() => p.onLayout?.(layout), [layout]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Full static repaint whenever the document, textures, zoom or fonts change.
  const animatedCells = useMemo(() => layout.cells.filter((c) => !c.sky && p.src.tex(c.row.id, c.col.id)?.timeline), [layout, p.version]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = Math.max(1, Math.round(layout.width * scale)), H = Math.max(1, Math.round(layout.height * scale));
    c.width = W;
    c.height = H;
    c.style.width = `${layout.width * p.zoom}px`;
    c.style.height = `${layout.height * p.zoom}px`;
    const live = p.playing && animOn;
    const st = (staticRef.current = new OffscreenCanvas(W, H));
    const sctx = st.getContext("2d")!;
    drawShowcase(sctx, p.sc, layout, p.src, { scale, tick: Math.floor(currentTick()), backgroundImage: bg, skipAnimated: live });
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(st, 0, 0);
    if (live) paintAnimated(Math.floor(currentTick()));
  }, [layout, p.version, scale, bg, fontsReady, p.playing, animOn]);

  function paintAnimated(tick: number) {
    const c = ref.current, st = staticRef.current;
    if (!c || !st) return;
    const ctx = c.getContext("2d")!;
    for (const cell of animatedCells) {
      const t = p.src.tex(cell.row.id, cell.col.id);
      if (!t) continue;
      const x = Math.floor(cell.x * scale), y = Math.floor(cell.y * scale);
      const w = Math.ceil(cell.w * scale) + 1, h = Math.ceil(cell.h * scale) + 1;
      ctx.clearRect(x, y, w, h);
      ctx.drawImage(st, x, y, w, h, x, y, w, h);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawTexture(ctx, t, cell, scale, Math.floor(tick * p.sc.style.animSpeed), p.sc.style.itemScale);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  useEffect(() => {
    if (!p.playing || !animOn || !animatedCells.length) return;
    if (pauseOff && !visible) return;
    return subscribeClock(paintAnimated);
  }, [p.playing, animOn, visible, pauseOff, animatedCells, scale, p.sc.style.animSpeed, p.sc.style.itemScale]);

  const hit = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / p.zoom, y = (e.clientY - r.top) / p.zoom;
    const cell = layout.cells.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    if (cell) return p.onSelect({ type: "cell", rowId: cell.row.id, colId: cell.col.id });
    const head = layout.headers.find((h) => x >= h.rect.x && x <= h.rect.x + h.rect.w && y >= h.rect.y && y <= h.rect.y + h.rect.h);
    if (head) return p.onSelect({ type: "col", colId: head.col.id });
    const row = layout.rows.find((rb) => y >= rb.band.y && y <= rb.band.y + rb.band.h && x <= rb.label.x + rb.label.w + 6);
    p.onSelect(row ? { type: "row", rowId: row.row.id } : null);
  };

  const outlines: { x: number; y: number; w: number; h: number }[] = [];
  const sel = p.selection;
  if (sel?.type === "cell") {
    const c = layout.cells.find((c) => c.row.id === sel.rowId && c.col.id === sel.colId);
    if (c) outlines.push(c);
  } else if (sel?.type === "row") {
    const rb = layout.rows.find((r) => r.row.id === sel.rowId);
    if (rb) outlines.push(rb.band);
  } else if (sel?.type === "col") {
    const cs = layout.cells.filter((c: CellBox) => c.col.id === sel.colId);
    cs.forEach((c) => outlines.push(c));
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <canvas ref={ref} onClick={hit} data-testid="showcase-canvas" style={{ cursor: "pointer" }} />
      {outlines.map((o, i) => (
        <div key={i} className="sel-outline" style={{ left: o.x * p.zoom - 2, top: o.y * p.zoom - 2, width: o.w * p.zoom + 4, height: o.h * p.zoom + 4 }} />
      ))}
    </div>
  );
}
