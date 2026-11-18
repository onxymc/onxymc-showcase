// Loads exactly the textures a showcase needs (and nothing else), plus sky strips.
import { useEffect, useMemo, useRef, useState } from "react";
import { getItemTexture, getPackView, getTexture, type LoadedTexture } from "../core/packAccess";
import { SKY_COLUMN } from "../core/catalog";
import { loadSkyLayers } from "../core/sky";
import type { Showcase } from "../core/showcase";
import type { TexSource } from "./showcaseRenderer";
import { bitmapToImageData, renderSky } from "./skyRender";

const skyStripCache = new Map<string, Promise<OffscreenCanvas | null>>();

export function skyStrip(packId: string, dayTime: number, w = 480, h = 120): Promise<OffscreenCanvas | null> {
  const key = `${packId}|${dayTime}|${w}x${h}`;
  let p = skyStripCache.get(key);
  if (!p) {
    p = (async () => {
      const view = await getPackView(packId);
      const layers = await loadSkyLayers(view);
      if (!layers.length) return null;
      const sources = [];
      for (const l of layers) {
        const t = await getTexture(packId, l.texturePath).catch(() => null);
        if (t) sources.push({ layer: l, image: bitmapToImageData(t.bitmap, 768) });
      }
      if (!sources.length) return null;
      const img = renderSky(sources, { dayTime, yaw: 0, pitch: 4, fov: 70, mode: "panorama" }, w, h);
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d")!.putImageData(img, 0, 0);
      return c;
    })().catch(() => null);
    skyStripCache.set(key, p);
    if (skyStripCache.size > 120) skyStripCache.delete(skyStripCache.keys().next().value!);
  }
  return p;
}

export function clearSkyCache(packId?: string) {
  for (const k of [...skyStripCache.keys()]) if (!packId || k.startsWith(packId + "|")) skyStripCache.delete(k);
}

export interface ShowcaseTexState {
  src: TexSource;
  version: number;
  textures: Map<string, LoadedTexture | null>;
  loading: boolean;
}

/** Signature of everything that affects which textures are needed. */
function needKey(sc: Showcase) {
  return JSON.stringify([sc.fallbackPackId, sc.style.skyTime, sc.columns.map((c) => c.id + c.key), sc.rows.map((r) => [r.id, r.packId, r.overrides, r.hidden])]);
}

export async function loadShowcaseTextures(sc: Showcase, onProgress?: () => void) {
  const textures = new Map<string, LoadedTexture | null>();
  const skies = new Map<string, OffscreenCanvas | null>();
  const jobs: Promise<void>[] = [];
  const hasSky = sc.columns.some((c) => c.key === SKY_COLUMN);
  for (const r of sc.rows) {
    if (r.hidden) continue;
    if (!r.packId) {
      if (hasSky) skies.set(r.id, null);
      continue;
    }
    const packId = r.packId;
    for (const c of sc.columns) {
      if (c.key === SKY_COLUMN) continue;
      const k = `${r.id}|${c.id}`;
      const ov = r.overrides[c.id];
      jobs.push(
        (ov ? getTexture(packId, ov) : getItemTexture(packId, c.key, sc.fallbackPackId))
          .catch(() => null)
          .then((t) => {
            textures.set(k, t);
            onProgress?.();
          }),
      );
    }
    if (hasSky)
      jobs.push(
        skyStrip(packId, sc.style.skyTime).then(async (c) => {
          // fall back to the showcase's fallback pack sky, then "vanilla"
          if (!c && sc.fallbackPackId) c = await skyStrip(sc.fallbackPackId, sc.style.skyTime);
          skies.set(r.id, c);
          onProgress?.();
        }),
      );
  }
  await Promise.all(jobs);
  const src: TexSource = {
    tex: (rowId, colId) => textures.get(`${rowId}|${colId}`),
    sky: (rowId) => skies.get(rowId),
  };
  return { src, textures, skies };
}

export function useShowcaseTextures(sc: Showcase | null): ShowcaseTexState {
  const [state, setState] = useState<ShowcaseTexState>(() => ({ src: { tex: () => undefined, sky: () => undefined }, version: 0, textures: new Map(), loading: true }));
  const key = useMemo(() => (sc ? needKey(sc) : ""), [sc]);
  const scRef = useRef(sc);
  scRef.current = sc;
  useEffect(() => {
    if (!scRef.current) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loadShowcaseTextures(scRef.current).then((r) => {
      if (!cancelled) setState((s) => ({ src: r.src, textures: r.textures, version: s.version + 1, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}
