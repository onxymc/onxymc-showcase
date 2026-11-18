// A small canvas that shows one pack texture; animated textures tick on the shared
// clock only while visible on screen.
import { useEffect, useRef, useState } from "react";
import { getItemTexture, getTexture, type LoadedTexture } from "../core/packAccess";
import { drawTexture } from "../render/showcaseRenderer";
import { subscribeClock, currentTick } from "../render/clock";
import { useApp } from "../state/store";

export function TextureView(p: { packId: string | null; itemKey?: string; path?: string; size?: number; className?: string; title?: string; onLoaded?: (t: LoadedTexture | null) => void }) {
  const size = p.size ?? 32;
  const ref = useRef<HTMLCanvasElement>(null);
  const [tex, setTex] = useState<LoadedTexture | null | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const pauseOff = useApp((s) => s.settings.pauseOffscreen);
  const animOn = useApp((s) => s.settings.animationsEnabled);

  useEffect(() => {
    let off = false;
    setTex(undefined);
    if (!p.packId) return setTex(null);
    const job = p.path ? getTexture(p.packId, p.path) : p.itemKey ? getItemTexture(p.packId, p.itemKey) : Promise.resolve(null);
    job.catch(() => null).then((t) => {
      if (off) return;
      setTex(t);
      p.onLoaded?.(t);
    });
    return () => {
      off = true;
    };
  }, [p.packId, p.itemKey, p.path]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    const paint = (tick: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      if (tex) drawTexture(ctx, tex, { x: 0, y: 0, w: c.width, h: c.height }, 1, tick, 1);
    };
    paint(Math.floor(currentTick()));
    if (tex?.timeline && animOn && (visible || !pauseOff)) return subscribeClock(paint);
  }, [tex, size, visible, pauseOff, animOn]);

  return <canvas ref={ref} className={`pixel ${p.className ?? ""}`} style={{ width: size, height: size, opacity: tex === null ? 0.15 : 1 }} title={p.title} />;
}
