// One shared animation clock for the whole app. Minecraft animations change at
// most once per game tick (20/s), so subscribers are only woken when the integer
// tick changes, and never more often than the configured FPS cap. The rAF loop
// stops entirely when nothing is subscribed or the window is hidden.
import { TICK_MS } from "../core/animation";

type Sub = (tick: number) => void;
const subs = new Set<Sub>();
let raf = 0;
let speed = 1;
let enabled = true;
let maxFps = 20;
let lastEmit = 0;
let lastTick = -1;
let base = performance.now();
let accumulated = 0; // ticks accumulated before the last speed change

export function configureClock(o: { speed?: number; enabled?: boolean; maxFps?: number }) {
  const now = performance.now();
  if (o.speed !== undefined && o.speed !== speed) {
    accumulated = currentTick(now);
    base = now;
    speed = o.speed;
  }
  if (o.maxFps !== undefined) maxFps = Math.max(1, o.maxFps);
  if (o.enabled !== undefined) {
    enabled = o.enabled;
    ensure();
  }
}

export function currentTick(now = performance.now()) {
  return accumulated + ((now - base) * speed) / TICK_MS;
}

function loop(now: number) {
  raf = 0;
  if (!enabled || subs.size === 0 || document.hidden) return;
  const tick = Math.floor(currentTick(now));
  if (tick !== lastTick && now - lastEmit >= 1000 / maxFps - 1) {
    lastTick = tick;
    lastEmit = now;
    for (const s of subs) s(tick);
  }
  raf = requestAnimationFrame(loop);
}

function ensure() {
  if (!raf && enabled && subs.size > 0 && !document.hidden) raf = requestAnimationFrame(loop);
}

document.addEventListener("visibilitychange", ensure);

export function subscribeClock(fn: Sub): () => void {
  subs.add(fn);
  ensure();
  return () => {
    subs.delete(fn);
  };
}

export function clockStats() {
  return { subscribers: subs.size, running: raf !== 0 };
}
