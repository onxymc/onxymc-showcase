// Optional decorative background: a few slow drifting motes (or snowflakes for the
// Christmas theme). Capped at 30 fps, ~40 particles, and stops when the window is hidden.
import { useEffect, useRef } from "react";

export function FxCanvas({ snow }: { snow: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let w = 0, h = 0, raf = 0, last = 0;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff2d46";
    const resize = () => {
      w = c.width = Math.round(window.innerWidth / 2);
      h = c.height = Math.round(window.innerHeight / 2);
    };
    resize();
    window.addEventListener("resize", resize);
    const n = snow ? 46 : 28;
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, s: 0.4 + Math.random() * 1.4, v: 0.08 + Math.random() * 0.25, d: Math.random() * Math.PI * 2 }));
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || t - last < 33) return;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y += snow ? p.v * 1.6 : -p.v * 0.6;
        p.x += Math.sin((p.d += 0.01)) * 0.15;
        if (p.y > h + 4) p.y = -4;
        if (p.y < -4) p.y = h + 4;
        ctx.globalAlpha = snow ? 0.55 : 0.22;
        ctx.fillStyle = snow ? "#ffffff" : accent;
        const sz = Math.max(1, Math.round(p.s * (snow ? 1.4 : 1)));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [snow]);
  return <canvas ref={ref} className="fx-canvas pixel" style={{ width: "100%", height: "100%" }} />;
}
