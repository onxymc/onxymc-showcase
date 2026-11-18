import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, ColorIn, Field, Select, Toggle } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { TextureView } from "../ui/TextureView";
import { getPackView, resolveTexturePath } from "../core/packAccess";
import { CATALOG } from "../core/catalog";
import { TexturePool, buildItem, buildPlayer, armorTextures, type Lighting } from "../render/mcModels";
import { subscribeClock } from "../render/clock";

type Mode = "item" | "armor";
type ViewMode = "3d" | "inventory";

export default function Models3D() {
  const packs = useApp((s) => s.packs);
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("item");
  const [target, setTarget] = useState<string>("catalog:netherite_sword");
  const [lighting, setLighting] = useState<Lighting>("minecraft");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [autoRotate, setAutoRotate] = useState(true);
  const [bg, setBg] = useState("#0b0b10");
  const [material, setMaterial] = useState("netherite");
  const [pieces, setPieces] = useState({ helmet: true, chest: true, legs: true, boots: true });
  const [modelFiles, setModelFiles] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [status, setStatus] = useState<{ note: string | null; warnings: string[]; fallback: boolean }>({ note: null, warnings: [], fallback: false });
  const [resetKey, setResetKey] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ setObject: (o: THREE.Object3D | null, display?: any) => void; reset: () => void; dispose: () => void; set: (o: any) => void } | null>(null);
  const poolRef = useRef<TexturePool | null>(null);

  useEffect(() => {
    if (!packId) return;
    getPackView(packId).then(async (v) => {
      setModelFiles(v.list().filter((f) => /^assets\/[^/]+\/models\/(item|block)\/.+\.json$/.test(f)).sort());
      const ok: string[] = [];
      for (const c of CATALOG) if (c.itemId && (await resolveTexturePath(packId, c.key))) ok.push(c.key);
      setAvailable(ok);
    });
  }, [packId]);

  // three.js scene lifecycle (render on demand only)
  useEffect(() => {
    const el = holder.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const persp = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    let cam: THREE.Camera = persp;
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 12;
    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(2, 3, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-3, 1, -2);
    scene.add(amb, dir, rim);
    let obj: THREE.Object3D | null = null;
    let auto = true;
    let inventory = false;
    let dirty = true;
    let raf = 0;
    const resize = () => {
      const w = el.clientWidth, h = Math.max(320, el.clientHeight);
      renderer.setSize(w, h);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      const a = w / h;
      ortho.left = -a;
      ortho.right = a;
      ortho.top = 1;
      ortho.bottom = -1;
      ortho.updateProjectionMatrix();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const reset = () => {
      persp.position.set(1.4, 0.9, 2.2);
      controls.target.set(0, 0, 0);
      controls.update();
      dirty = true;
    };
    reset();
    controls.addEventListener("change", () => (dirty = true));
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (auto && obj && !inventory) {
        obj.rotation.y += 0.008;
        dirty = true;
      }
      controls.update();
      if (dirty) {
        renderer.render(scene, cam);
        dirty = false;
      }
    };
    loop();
    sceneRef.current = {
      setObject(o, display) {
        if (obj) scene.remove(obj);
        obj = o;
        if (o) {
          // inventory view uses the model's own gui display transform when present
          const gui = display?.gui;
          if (inventory && gui) {
            const r = (gui.rotation ?? [0, 0, 0]).map((d: number) => (d * Math.PI) / 180);
            o.rotation.set(r[0], r[1], r[2]);
            const s = gui.scale ?? [1, 1, 1];
            o.scale.set(s[0] * 1.6, s[1] * 1.6, s[2] * 1.6);
          } else {
            o.rotation.set(0, inventory ? 0 : -0.5, 0);
            o.scale.setScalar(inventory ? 1.6 : 1);
          }
          scene.add(o);
        }
        dirty = true;
      },
      reset,
      set(o) {
        if (o.bg) renderer.setClearColor(o.bg);
        if (o.auto !== undefined) auto = o.auto;
        if (o.lighting) {
          amb.intensity = o.lighting === "studio" ? 0.55 : 1;
          dir.visible = rim.visible = o.lighting === "studio";
        }
        if (o.inventory !== undefined) {
          inventory = o.inventory;
          cam = inventory ? ortho : persp;
          controls.enabled = !inventory;
          if (inventory) ortho.position.set(0, 0, 5), ortho.lookAt(0, 0, 0);
        }
        dirty = true;
      },
      dispose() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        el.removeChild(renderer.domElement);
      },
    };
    (sceneRef.current as any).markDirty = () => (dirty = true);
    return () => sceneRef.current?.dispose();
  }, []);

  useEffect(() => {
    sceneRef.current?.set({ bg, auto: autoRotate, lighting, inventory: viewMode === "inventory" });
  }, [bg, autoRotate, lighting, viewMode]);
  useEffect(() => sceneRef.current?.reset(), [resetKey]);

  // build the current object
  useEffect(() => {
    if (!packId) return;
    let cancelled = false;
    (async () => {
      const view = await getPackView(packId);
      poolRef.current?.dispose();
      const pool = new TexturePool(packId, lighting, mode === "armor" && material === "leather" ? new THREE.Color("#a06540") : null);
      poolRef.current = pool;
      if (mode === "armor") {
        const t = armorTextures(view, material);
        const { group, notes } = await buildPlayer(view, packId, { helmet: pieces.helmet ? t.outer : null, chest: pieces.chest ? t.outer : null, legs: pieces.legs ? t.legs : null, boots: pieces.boots ? t.outer : null }, lighting);
        if (cancelled) return;
        group.scale.setScalar(0.72);
        group.position.y = -0.72;
        const holderGroup = new THREE.Group();
        holderGroup.add(group);
        sceneRef.current?.setObject(holderGroup);
        const missing = !t.outer && !t.legs;
        setStatus({ note: [...notes, missing ? `This pack doesn't override ${material} armor layers (equipment/humanoid or models/armor) — the 2D item icons are shown below instead.` : null].filter(Boolean).join(" ") || null, warnings: [], fallback: missing });
        return;
      }
      const [kind, ref] = target.split(/:(.*)/s);
      const res = await buildItem(view, packId, kind === "catalog" ? { itemId: ref, texturePath: (await resolveTexturePath(packId, ref)) ?? undefined } : { modelPath: ref }, pool, lighting);
      if (cancelled) return;
      if (!res) {
        sceneRef.current?.setObject(null);
        setStatus({ note: "This model can't be rendered accurately here (it relies on a built-in/entity renderer such as the shield or trident, or on textures not inside this pack). Showing the 2D texture instead.", warnings: [], fallback: true });
        return;
      }
      sceneRef.current?.setObject(res.group, res.display);
      setStatus({ note: res.kind === "sprite" ? "Flat item, extruded 1 px deep like in-game." : null, warnings: res.warnings, fallback: false });
    })().catch((e) => setStatus({ note: String(e?.message ?? e), warnings: [], fallback: true }));
    return () => {
      cancelled = true;
    };
  }, [packId, target, mode, material, pieces, lighting, viewMode]);

  // animated textures on 3D models tick on the shared clock
  useEffect(
    () =>
      subscribeClock((t) => {
        if (poolRef.current?.tick(t)) (sceneRef.current as any)?.markDirty?.();
      }),
    [],
  );

  const itemOpts = useMemo(
    () => [
      ...available.map((k) => ({ value: `catalog:${k}`, label: CATALOG.find((c) => c.key === k)!.label })),
      ...modelFiles.map((f) => ({ value: `model:${f}`, label: `Model: ${f.replace(/^assets\/[^/]+\/models\//, "")}` })),
    ],
    [available, modelFiles],
  );
  const catKey = target.startsWith("catalog:") ? target.slice(8) : null;

  return (
    <>
      <TopBar title="3D Item & Armor Preview" sub="Minecraft model JSON: parents, texture aliases, element rotations, animated textures">
        <div style={{ width: 240 }}>
          <Select value={packId} onChange={setPackId} options={packs.length ? packs.map((p) => ({ value: p.id, label: p.name })) : [{ value: "", label: "No packs" }]} />
        </div>
      </TopBar>
      <div className="content">
        {!packs.length ? (
          <div className="panel empty"><Icon name="cube" size={40} /><h2>Import a pack to preview its models</h2></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
            <div className="col" style={{ gap: 10 }}>
              <div className="viewport3d" ref={holder} style={{ height: "calc(100vh - 210px)" }}>
                {status.note && <div className="overlay-note">{status.note}{status.warnings.length > 0 && <div className="tiny" style={{ marginTop: 4, opacity: 0.8 }}>{status.warnings.slice(0, 3).join(" · ")}</div>}</div>}
              </div>
              {status.fallback && (
                <div className="panel pad row" style={{ gap: 18 }}>
                  {mode === "armor"
                    ? ["helmet", "chestplate", "leggings", "boots"].map((p) => <TextureView key={p} packId={packId} itemKey={`${material}_${p}`} size={64} />)
                    : catKey && <TextureView packId={packId} itemKey={catKey} size={128} />}
                  <span className="small muted">2D preview (supported fallback)</span>
                </div>
              )}
            </div>
            <div className="panel pad col">
              <Field label="Preview">
                <Select<Mode> value={mode} onChange={setMode} options={[{ value: "item", label: "Item / block model" }, { value: "armor", label: "Armor on player model" }]} />
              </Field>
              {mode === "item" ? (
                <Field label="Item or model">
                  <Select value={target} onChange={setTarget} options={itemOpts.length ? itemOpts : [{ value: target, label: "Nothing detected" }]} />
                </Field>
              ) : (
                <>
                  <Field label="Armor material">
                    <Select value={material} onChange={setMaterial} options={["netherite", "diamond", "iron", "golden", "chainmail", "leather", "turtle_scute"].map((m) => ({ value: m, label: m.replace("_", " ") }))} />
                  </Field>
                  {(["helmet", "chest", "legs", "boots"] as const).map((k) => (
                    <Toggle key={k} label={k === "chest" ? "Chestplate" : k === "legs" ? "Leggings" : k[0].toUpperCase() + k.slice(1)} value={pieces[k]} onChange={(v) => setPieces({ ...pieces, [k]: v })} />
                  ))}
                </>
              )}
              <div className="hr" />
              <Field label="View">
                <Select<ViewMode> value={viewMode} onChange={setViewMode} options={[{ value: "3d", label: "Free 3D (orbit)" }, { value: "inventory", label: "Inventory style (GUI transform)" }]} />
              </Field>
              <Field label="Lighting">
                <Select<Lighting> value={lighting} onChange={setLighting} options={[{ value: "minecraft", label: "Minecraft face shading" }, { value: "studio", label: "Studio lights" }, { value: "flat", label: "Flat / unlit" }]} />
              </Field>
              <Field label="Background"><ColorIn value={bg} onChange={setBg} /></Field>
              <Toggle label="Auto-rotate" value={autoRotate} onChange={setAutoRotate} />
              <Btn icon="restart" onClick={() => setResetKey((k) => k + 1)}>Reset camera</Btn>
              <span className="tiny muted">Drag to rotate · scroll to zoom · right-drag to pan.</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
