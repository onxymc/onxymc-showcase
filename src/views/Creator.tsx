import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, ColorIn, Field, Modal, Select, Slider, TextIn, Toggle, confirmDialog } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { TextureView } from "../ui/TextureView";
import { ShowcaseCanvas, type Selection } from "../ui/ShowcaseCanvas";
import { useHistory } from "../state/history";
import { useShowcaseTextures } from "../render/showcaseData";
import { computeLayout } from "../render/showcaseRenderer";
import { CATALOG, CUSTOM_PREFIX, SKY_COLUMN, columnLabel, type CatalogCategory } from "../core/catalog";
import { BASE_STYLE, FONTS, TEMPLATES, applyTemplate, normalizeShowcase, makeColumns, newShowcase, uid, type FontId, type Showcase, type ShowcaseRow, type ShowcaseStyle, type TemplateDef } from "../core/showcase";
import { getPackView } from "../core/packAccess";
import { blobToDataUrl } from "../core/importer";
import { ExportDialog } from "./ExportDialog";
import { usePointerReorder, moveInList, moveBy } from "../ui/usePointerReorder";
import { saveBytes } from "../platform";

export function Creator() {
  const activeId = useApp((s) => s.activeShowcaseId);
  const sc = useApp((s) => s.showcases.find((x) => x.id === activeId));
  return sc ? <Editor key={sc.id} initial={sc} /> : <ShowcaseList />;
}

// ---------------------------------------------------------------- list + wizard
function ShowcaseList() {
  const showcases = useApp((s) => s.showcases);
  const packs = useApp((s) => s.packs);
  const setActive = useApp((s) => s.setActiveShowcase);
  const [wizard, setWizard] = useState(false);
  const importProject = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = ".onxyshowcase,.json";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      const st = useApp.getState();
      try {
        if (f.size > 32 * 1024 * 1024) throw new Error("file too large");
        const data = JSON.parse(await f.text());
        const sc = normalizeShowcase(data?.showcase ?? data);
        if (!sc) throw new Error("not a showcase project");
        const exists = st.showcases.some((s) => s.id === sc.id);
        const final = exists ? { ...sc, id: uid(), name: `${sc.name} (imported)` } : sc;
        // rows whose pack is not in this library keep their name/colour but show empty cells
        final.rows = final.rows.map((r) => (r.packId && !st.packs.some((p) => p.id === r.packId) ? { ...r, packId: null } : r));
        st.upsertShowcase(final);
        st.toast(`Opened “${final.name}”`, "success");
      } catch (e: any) {
        st.toast(`Could not open project: ${e.message ?? e}`, "error");
      }
    };
    i.click();
  };
  return (
    <>
      <TopBar title="Showcase Creator" sub="Build Kino-style showcases from your real pack textures">
        <Btn icon="upload" onClick={importProject}>
          Open project file
        </Btn>
        <Btn kind="primary" icon="plus" onClick={() => setWizard(true)} disabled={!packs.length}>
          Create New Showcase
        </Btn>
      </TopBar>
      <div className="content">
        {!packs.length && (
          <div className="panel empty">
            <Icon name="library" size={40} />
            <h2>Import a texture pack first</h2>
            <div>Showcases are built from the actual textures inside your packs.</div>
            <Btn kind="primary" onClick={() => useApp.getState().setView("library")}>
              Go to Library
            </Btn>
          </div>
        )}
        {packs.length > 0 && !showcases.length && (
          <div className="panel empty">
            <Icon name="creator" size={40} />
            <h2>No showcases yet</h2>
            <Btn kind="primary" icon="plus" onClick={() => setWizard(true)}>
              Create New Showcase
            </Btn>
          </div>
        )}
        <div className="template-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {[...showcases].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => (
            <div key={s.id} className="panel pad template" onClick={() => setActive(s.id)} data-showcase={s.name}>
              <b>{s.name}</b>
              <div className="small muted">
                {s.rows.length} variant{s.rows.length === 1 ? "" : "s"} · {s.columns.length} items · {TEMPLATES.find((t) => t.id === s.templateId)?.name ?? "Custom"}
              </div>
              <div className="row" style={{ marginTop: 8, gap: 4 }}>
                {s.rows.slice(0, 8).map((r) => (
                  <span key={r.id} className="swatch" style={{ background: r.color }} title={r.name} />
                ))}
              </div>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Edited {new Date(s.updatedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
      {wizard && <NewShowcaseWizard onClose={() => setWizard(false)} />}
    </>
  );
}

function NewShowcaseWizard({ onClose }: { onClose: () => void }) {
  const packs = useApp((s) => s.packs);
  const custom = useApp((s) => s.customTemplates);
  const [name, setName] = useState("My Showcase");
  const [sel, setSel] = useState<string[]>(packs[0] ? [packs[0].id] : []);
  const [tpl, setTpl] = useState("kino-classic");
  const all = [...TEMPLATES, ...custom];
  const create = () => {
    const chosen = sel.map((id) => packs.find((p) => p.id === id)!).filter(Boolean);
    let sc = newShowcase(name.trim() || "Untitled", tpl, chosen.map((p) => ({ id: p.id, name: p.name, color: p.accentColor })));
    const t = all.find((x) => x.id === tpl);
    if (t && custom.includes(t)) sc = applyTemplate(sc, t, true);
    sc.title = sc.name;
    const st = useApp.getState();
    st.upsertShowcase(sc);
    st.setActiveShowcase(sc.id);
    onClose();
  };
  return (
    <Modal
      wide
      title="Create New Showcase"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" icon="check" disabled={!sel.length} onClick={create}>
            Create showcase
          </Btn>
        </>
      }
    >
      <Field label="1. Showcase name">
        <TextIn value={name} onChange={setName} />
      </Field>
      <Field label={`2. Texture packs — each becomes a variant row (${sel.length} selected)`}>
        <div className="template-grid" style={{ maxHeight: 220, overflow: "auto" }}>
          {packs.map((p) => {
            const on = sel.includes(p.id);
            return (
              <div key={p.id} className={`template row ${on ? "on" : ""}`} onClick={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>
                {p.iconDataUrl && <img src={p.iconDataUrl} width={28} height={28} className="pixel" style={{ borderRadius: 5 }} alt="" />}
                <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                {on && <Icon name="check" size={16} />}
              </div>
            );
          })}
        </div>
      </Field>
      <Field label="3. Layout template">
        <div className="template-grid">
          {all.map((t) => (
            <div key={t.id} className={`template ${tpl === t.id ? "on" : ""}`} onClick={() => setTpl(t.id)}>
              <b>{t.name}</b>
              <span className="small muted">{t.blurb}</span>
            </div>
          ))}
        </div>
      </Field>
      <span className="small muted">Then customise everything with a live preview, and save or export.</span>
    </Modal>
  );
}

// ---------------------------------------------------------------- editor
function Editor({ initial }: { initial: Showcase }) {
  const upsert = useApp((s) => s.upsertShowcase);
  const packs = useApp((s) => s.packs);
  const persist = useCallback((v: Showcase) => upsert({ ...v, updatedAt: Date.now() }), [upsert]);
  const hist = useHistory<Showcase>(initial, persist);
  const sc = hist.value;
  const tex = useShowcaseTextures(sc);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [sel, setSel] = useState<Selection>(null);
  const [picker, setPicker] = useState<null | { mode: "add" } | { mode: "cell"; rowId: string; colId: string }>(null);
  const [exporting, setExporting] = useState(false);
  const [panel, setPanel] = useState<"style" | "selection">("style");

  const edit = (fn: (s: Showcase) => Showcase, key = "") => hist.set(fn(structuredClone(sc)), key);
  const style = (patch: Partial<ShowcaseStyle>, key = Object.keys(patch).join()) => edit((s) => ({ ...s, style: { ...s.style, ...patch } }), key);
  const editRow = (id: string, patch: Partial<ShowcaseRow>, key = "") => edit((s) => ({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }), key ? `${id}.${key}` : "");

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? hist.redo() : hist.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        hist.redo();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [hist]);

  useEffect(() => {
    if (sel) setPanel("selection");
  }, [sel]);

  const fit = () => {
    const l = computeLayout(sc);
    const stage = document.querySelector(".stage") as HTMLElement | null;
    if (stage) setZoom(Math.max(0.25, Math.min(3, Math.floor(((stage.clientWidth - 80) / l.width) * 20) / 20)));
  };

  const saveTemplate = async () => {
    const name = window.prompt("Template name", `${sc.name} template`);
    if (!name) return;
    const t: TemplateDef = { id: `custom-${uid()}`, name, blurb: "Custom template", style: { ...sc.style, backgroundImage: null }, columns: sc.columns.map((c) => c.key) };
    useApp.getState().addCustomTemplate(t);
    useApp.getState().toast(`Saved template “${name}”`, "success");
  };
  const duplicate = () => {
    const copy = { ...structuredClone(sc), id: uid(), name: `${sc.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
    upsert(copy);
    useApp.getState().setActiveShowcase(copy.id);
  };
  const saveProject = async () => {
    const data = { app: "onxymc-showcase", kind: "showcase-project", version: 1, showcase: sc };
    const st = useApp.getState();
    const path = await saveBytes(`${sc.name.replace(/[\\/:*?"<>|]/g, "_")}.onxyshowcase`, new TextEncoder().encode(JSON.stringify(data, null, 2)), [{ name: "OnxyMc showcase project", extensions: ["onxyshowcase"] }], st.settings.exportDir ?? undefined);
    if (path) st.toast("Project file saved", "success");
  };

  return (
    <>
      <TopBar title={sc.name} sub={`${sc.rows.length} variants · ${sc.columns.length} items · autosaved`}>
        <Btn icon="library" onClick={() => useApp.getState().setActiveShowcase(null)}>
          All showcases
        </Btn>
        <Btn icon="copy" onClick={duplicate}>
          Duplicate
        </Btn>
        <Btn icon="save" onClick={saveProject}>
          Save project file
        </Btn>
        <Btn kind="primary" icon="download" onClick={() => setExporting(true)}>
          Export
        </Btn>
      </TopBar>
      <div className="content flush">
        <div className="creator">
          {/* -------- left: structure */}
          <div className="side">
            <Field label="Showcase name">
              <TextIn value={sc.name} onChange={(v) => edit((s) => ({ ...s, name: v }), "name")} />
            </Field>
            <RowsPanel sc={sc} edit={edit} editRow={editRow} sel={sel} setSel={setSel} />
            <ColumnsPanel sc={sc} edit={edit} sel={sel} setSel={setSel} onAdd={() => setPicker({ mode: "add" })} />
            <Field label="Fallback pack (fills textures a variant doesn't override)">
              <Select value={sc.fallbackPackId ?? ""} onChange={(v) => edit((s) => ({ ...s, fallbackPackId: v || null }))} options={[{ value: "", label: "None — leave empty" }, ...packs.map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
          </div>

          {/* -------- center: live preview */}
          <div className="stage">
            <div className="stage-toolbar">
              <Btn sm iconOnly icon="undo" title="Undo (Ctrl+Z)" disabled={!hist.canUndo} onClick={hist.undo} />
              <Btn sm iconOnly icon="redo" title="Redo (Ctrl+Y)" disabled={!hist.canRedo} onClick={hist.redo} />
              <div style={{ width: 1, height: 20, background: "var(--panel-border)" }} />
              <Btn sm iconOnly icon={playing ? "pause" : "play"} title={playing ? "Pause animations (Space)" : "Play animations (Space)"} onClick={() => setPlaying(!playing)} />
              <Btn sm iconOnly icon="zoomout" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))} />
              <span className="small" style={{ width: 44, textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <Btn sm iconOnly icon="zoomin" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)))} />
              <Btn sm onClick={fit}>
                Fit
              </Btn>
              <Btn sm onClick={() => setZoom(1)}>
                100%
              </Btn>
              <div className="grow" />
              {tex.loading && <span className="tiny muted">Loading textures…</span>}
              <Btn sm icon="refresh" title="Reset style to the template defaults" onClick={async () => {
                if (await confirmDialog("Reset style?", "All style settings return to the template's defaults. Rows and items are kept. You can undo this.", "Reset")) {
                  const t = [...TEMPLATES, ...useApp.getState().customTemplates].find((x) => x.id === sc.templateId) ?? TEMPLATES[0];
                  edit((s) => ({ ...s, style: { ...BASE_STYLE, ...t.style } }));
                }
              }}>
                Reset
              </Btn>
            </div>
            <div className="stage-inner" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
              <ShowcaseCanvas sc={sc} src={tex.src} version={tex.version} zoom={zoom} playing={playing} selection={sel} onSelect={setSel} />
            </div>
          </div>

          {/* -------- right: inspector */}
          <div className="side right">
            <div className="row" style={{ gap: 4 }}>
              <button className={`btn sm grow ${panel === "style" ? "on" : ""}`} onClick={() => setPanel("style")}>
                Style
              </button>
              <button className={`btn sm grow ${panel === "selection" ? "on" : ""}`} onClick={() => setPanel("selection")}>
                Selection
              </button>
            </div>
            {panel === "selection" ? (
              <SelectionPanel sc={sc} sel={sel} editRow={editRow} edit={edit} onPickCell={(rowId, colId) => setPicker({ mode: "cell", rowId, colId })} />
            ) : (
              <StylePanel sc={sc} edit={edit} style={style} onSaveTemplate={saveTemplate} />
            )}
          </div>
        </div>
      </div>
      {picker && (
        <ItemPicker
          sc={sc}
          mode={picker}
          onClose={() => setPicker(null)}
          onAdd={(keys) => {
            edit((s) => ({ ...s, columns: [...s.columns, ...makeColumns(keys)] }));
            setPicker(null);
          }}
          onCell={(path) => {
            if (picker.mode !== "cell") return;
            const row = sc.rows.find((r) => r.id === picker.rowId)!;
            const overrides = { ...row.overrides };
            if (path) overrides[picker.colId] = path;
            else delete overrides[picker.colId];
            editRow(picker.rowId, { overrides });
            setPicker(null);
          }}
        />
      )}
      {exporting && <ExportDialog sc={sc} onClose={() => setExporting(false)} />}
    </>
  );
}

type EditFn = (fn: (s: Showcase) => Showcase, key?: string) => void;

function RowsPanel({ sc, edit, editRow, sel, setSel }: { sc: Showcase; edit: EditFn; editRow: (id: string, p: Partial<ShowcaseRow>, k?: string) => void; sel: Selection; setSel: (s: Selection) => void }) {
  const packs = useApp((s) => s.packs);
  const { itemProps } = usePointerReorder((from, to, after) => edit((s) => ({ ...s, rows: moveInList(s.rows, from, to, after) })));
  const [adding, setAdding] = useState(false);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="section-title">
        <span>Variants / rows</span>
        <Btn sm iconOnly icon="plus" title="Add variant row" onClick={() => setAdding(!adding)} />
      </div>
      {adding && (
        <Select
          value=""
          onChange={(id) => {
            const p = packs.find((x) => x.id === id);
            if (!p) return;
            edit((s) => ({ ...s, rows: [...s.rows, { id: uid(), packId: p.id, name: p.name, color: p.accentColor ?? "#888888", badge: "", overrides: {}, hidden: false }] }));
            setAdding(false);
          }}
          options={[{ value: "", label: "Choose a pack…" }, ...packs.map((p) => ({ value: p.id, label: p.name }))]}
        />
      )}
      <div className="dnd-list">
        {sc.rows.map((r) => {
          const d = itemProps(r.id);
          const on = sel?.type === "row" && sel.rowId === r.id;
          return (
            <div key={r.id} {...d} title="Drag to reorder" className={`dnd-item ${d.className} ${on ? "sel" : ""}`} onClick={() => setSel({ type: "row", rowId: r.id })} data-row={r.name}>
              <Icon name="grip" size={14} className="grip" />
              <span className="swatch" style={{ background: r.color }} />
              <span className="grow small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: r.hidden ? 0.4 : 1 }}>
                {r.name || "Untitled"}
              </span>
              <button className="btn ghost sm icon" title={r.hidden ? "Show row" : "Hide row"} onClick={(e) => (e.stopPropagation(), editRow(r.id, { hidden: !r.hidden }))}>
                <Icon name={r.hidden ? "eyeoff" : "eye"} size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ColumnsPanel({ sc, edit, sel, setSel, onAdd }: { sc: Showcase; edit: EditFn; sel: Selection; setSel: (s: Selection) => void; onAdd: () => void }) {
  const { itemProps } = usePointerReorder((from, to, after) => edit((s) => ({ ...s, columns: moveInList(s.columns, from, to, after) })));
  const firstPack = sc.rows.find((r) => r.packId)?.packId ?? null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="section-title">
        <span>Items / columns</span>
        <Btn sm icon="plus" onClick={onAdd}>
          Add items
        </Btn>
      </div>
      <div className="dnd-list">
        {sc.columns.map((c) => {
          const d = itemProps(c.id);
          const on = sel?.type === "col" && sel.colId === c.id;
          return (
            <div key={c.id} {...d} title="Drag to reorder" className={`dnd-item ${d.className} ${on ? "sel" : ""}`} onClick={() => setSel({ type: "col", colId: c.id })}>
              <Icon name="grip" size={14} className="grip" />
              {c.key === SKY_COLUMN ? <Icon name="sky" size={20} /> : <TextureView packId={firstPack} itemKey={c.key.startsWith(CUSTOM_PREFIX) ? undefined : c.key} path={c.key.startsWith(CUSTOM_PREFIX) ? c.key.slice(CUSTOM_PREFIX.length) : undefined} size={22} />}
              <span className="grow small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.label || columnLabel(c.key)}
              </span>
              <button className="btn ghost sm icon" title="Remove item" onClick={(e) => (e.stopPropagation(), edit((s) => ({ ...s, columns: s.columns.filter((x) => x.id !== c.id) })))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionPanel({ sc, sel, editRow, edit, onPickCell }: { sc: Showcase; sel: Selection; editRow: (id: string, p: Partial<ShowcaseRow>, k?: string) => void; edit: EditFn; onPickCell: (rowId: string, colId: string) => void }) {
  const packs = useApp((s) => s.packs);
  if (!sel) return <div className="muted small">Click a row label, an item cell or an item in the lists to edit it here.</div>;
  const rowId = sel.type === "row" || sel.type === "cell" ? sel.rowId : null;
  const colId = sel.type === "col" || sel.type === "cell" ? sel.colId : null;
  const row = sc.rows.find((r) => r.id === rowId);
  const col = sc.columns.find((c) => c.id === colId);
  return (
    <div className="col" style={{ gap: 14 }}>
      {row && (
        <div className="col" style={{ gap: 10 }}>
          <div className="section-title">Variant row</div>
          <Field label="Name">
            <TextIn value={row.name} onChange={(v) => editRow(row.id, { name: v }, "name")} />
          </Field>
          <Field label="Colour (swatch, hex label, glow)">
            <ColorIn value={row.color} onChange={(v) => editRow(row.id, { color: v }, "color")} />
          </Field>
          <Field label="Texture pack">
            <Select value={row.packId ?? ""} onChange={(v) => editRow(row.id, { packId: v || null })} options={[{ value: "", label: "None" }, ...packs.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Badge (e.g. NEW)">
            <TextIn value={row.badge} onChange={(v) => editRow(row.id, { badge: v }, "badge")} maxLength={16} />
          </Field>
          <div className="row">
            <Btn sm icon="undo" title="Move row up" onClick={() => edit((s) => ({ ...s, rows: moveBy(s.rows, row.id, -1) }))}>Move up</Btn>
            <Btn sm icon="redo" title="Move row down" onClick={() => edit((s) => ({ ...s, rows: moveBy(s.rows, row.id, 1) }))}>Move down</Btn>
          </div>
          <div className="row">
            <Btn sm icon="copy" onClick={() => edit((s) => {
              const i = s.rows.findIndex((r) => r.id === row.id);
              const rows = [...s.rows];
              rows.splice(i + 1, 0, { ...structuredClone(row), id: uid(), name: `${row.name} copy` });
              return { ...s, rows };
            })}>
              Duplicate
            </Btn>
            <Btn sm kind="danger" icon="trash" onClick={() => edit((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== row.id) }))}>
              Delete row
            </Btn>
          </div>
        </div>
      )}
      {col && (
        <div className="col" style={{ gap: 10 }}>
          <div className="section-title">Item column</div>
          <div className="small">{columnLabel(col.key)} <span className="muted tiny mono">{col.key}</span></div>
          <div className="row">
            <Btn sm icon="undo" title="Move item left" onClick={() => edit((s) => ({ ...s, columns: moveBy(s.columns, col.id, -1) }))}>Move left</Btn>
            <Btn sm icon="redo" title="Move item right" onClick={() => edit((s) => ({ ...s, columns: moveBy(s.columns, col.id, 1) }))}>Move right</Btn>
          </div>
          <Field label="Custom label (column header)">
            <TextIn value={col.label} placeholder={columnLabel(col.key)} onChange={(v) => edit((s) => ({ ...s, columns: s.columns.map((c) => (c.id === col.id ? { ...c, label: v } : c)) }), `col.${col.id}`)} />
          </Field>
        </div>
      )}
      {row && col && col.key !== SKY_COLUMN && (
        <div className="col" style={{ gap: 8 }}>
          <div className="section-title">This cell</div>
          <div className="small muted">{row.overrides[col.id] ? <>Custom texture: <span className="mono tiny">{row.overrides[col.id]}</span></> : "Auto-detected from the pack (item definitions, models, then default paths)."}</div>
          <div className="row">
            <Btn sm icon="image" disabled={!row.packId} onClick={() => onPickCell(row.id, col.id)}>
              Choose texture…
            </Btn>
            {row.overrides[col.id] && (
              <Btn sm kind="ghost" onClick={() => { const o = { ...row.overrides }; delete o[col.id]; editRow(row.id, { overrides: o }); }}>
                Use auto
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StylePanel({ sc, edit, style, onSaveTemplate }: { sc: Showcase; edit: EditFn; style: (p: Partial<ShowcaseStyle>, k?: string) => void; onSaveTemplate: () => void }) {
  const s = sc.style;
  const custom = useApp((st) => st.customTemplates);
  const fontOpts = (Object.keys(FONTS) as FontId[]).map((f) => ({ value: f, label: FONTS[f].label }));
  const pickBg = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/png,image/jpeg,image/webp";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
        const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        style({ backgroundImage: await blobToDataUrl(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 })) });
      } catch {
        useApp.getState().toast("That image could not be read", "error");
      }
    };
    i.click();
  };
  return (
    <div className="col" style={{ gap: 4 }}>
      <details className="sec" open>
        <summary>Template</summary>
        <div>
          <Select
            value={sc.templateId}
            onChange={async (id) => {
              const t = [...TEMPLATES, ...custom].find((x) => x.id === id)!;
              const replace = await confirmDialog(`Apply “${t.name}”?`, "Keep your current items, or also replace them with the template's item set?", "Apply & replace items", { extra: [{ label: "Apply style only", value: "style" }] });
              if (replace) edit((x) => applyTemplate(x, t, replace === "ok"));
            }}
            options={[...TEMPLATES, ...custom].map((t) => ({ value: t.id, label: t.name }))}
          />
          <Btn sm icon="save" onClick={onSaveTemplate}>
            Save as my template
          </Btn>
        </div>
      </details>
      <details className="sec" open>
        <summary>Title & text</summary>
        <div>
          <Field label="Title">
            <TextIn value={sc.title} onChange={(v) => edit((x) => ({ ...x, title: v }), "title")} />
          </Field>
          <Field label="Subtitle">
            <TextIn value={sc.subtitle} onChange={(v) => edit((x) => ({ ...x, subtitle: v }), "subtitle")} />
          </Field>
          <div className="grid2">
            <Field label="Corner text">
              <TextIn value={sc.cornerText} placeholder="NEW: …" onChange={(v) => edit((x) => ({ ...x, cornerText: v }), "corner")} />
            </Field>
            <Field label="Corner sub-text">
              <TextIn value={sc.cornerSubText} onChange={(v) => edit((x) => ({ ...x, cornerSubText: v }), "corner2")} />
            </Field>
          </div>
          <div className="grid2">
            <Field label="Title font">
              <Select value={s.titleFont} onChange={(v) => style({ titleFont: v })} options={fontOpts} />
            </Field>
            <Field label="Label font">
              <Select value={s.labelFont} onChange={(v) => style({ labelFont: v })} options={fontOpts} />
            </Field>
          </div>
          <Slider label="Title size" min={10} max={64} value={s.titleSize} onChange={(v) => style({ titleSize: v })} />
          <Slider label="Name size" min={8} max={40} value={s.labelSize} onChange={(v) => style({ labelSize: v })} />
          <Slider label="Hex / small text size" min={7} max={28} value={s.hexSize} onChange={(v) => style({ hexSize: v })} />
          <div className="grid2">
            <Field label="Title colour"><ColorIn value={s.titleColor} onChange={(v) => style({ titleColor: v })} /></Field>
            <Field label="Subtitle colour"><ColorIn value={s.subtitleColor} onChange={(v) => style({ subtitleColor: v })} /></Field>
            <Field label="Corner / badge"><ColorIn value={s.cornerColor} onChange={(v) => style({ cornerColor: v })} /></Field>
            <Field label="Hex label colour"><ColorIn value={s.hexColor} onChange={(v) => style({ hexColor: v })} /></Field>
          </div>
          <Field label="Variant name colour">
            <Select value={s.nameColorMode} onChange={(v) => style({ nameColorMode: v })} options={[{ value: "fixed", label: "Fixed colour" }, { value: "row", label: "Use each variant's colour" }]} />
          </Field>
          {s.nameColorMode === "fixed" && <ColorIn value={s.nameColor} onChange={(v) => style({ nameColor: v })} />}
        </div>
      </details>
      <details className="sec" open>
        <summary>Layout</summary>
        <div>
          <Field label="Layout">
            <Select value={s.layout} onChange={(v) => style({ layout: v })} options={[{ value: "rows", label: "Horizontal rows (compare)" }, { value: "grid", label: "Grid per pack" }]} />
          </Field>
          {s.layout === "grid" && <Slider label="Grid columns" min={1} max={16} value={s.gridColumns} onChange={(v) => style({ gridColumns: v })} />}
          <Slider label="Cell size" min={24} max={160} value={s.cellSize} onChange={(v) => style({ cellSize: v })} />
          <Slider label="Item size in cell" min={0.3} max={1} step={0.05} value={s.itemScale} onChange={(v) => style({ itemScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Extra row height" min={0} max={80} value={s.rowHeightExtra} onChange={(v) => style({ rowHeightExtra: v })} />
          <Slider label="Column spacing" min={0} max={48} value={s.colGap} onChange={(v) => style({ colGap: v })} />
          <Slider label="Row spacing" min={0} max={60} value={s.rowGap} onChange={(v) => style({ rowGap: v })} />
          <Slider label="Outer padding" min={0} max={120} value={s.padding} onChange={(v) => style({ padding: v })} />
          {s.layout === "rows" && <Toggle label="Fit label column to names" value={s.labelWidthAuto} onChange={(v) => style({ labelWidthAuto: v })} />}
          {s.layout === "rows" && !s.labelWidthAuto && <Slider label="Label column width" min={0} max={500} value={s.labelWidth} onChange={(v) => style({ labelWidth: v })} />}
          <Slider label="Sky preview width (cells)" min={1} max={10} step={0.1} value={s.skyWidthCells} onChange={(v) => style({ skyWidthCells: v })} />
          <Toggle label="Column headers" value={s.showColumnHeaders} onChange={(v) => style({ showColumnHeaders: v })} />
        </div>
      </details>
      <details className="sec">
        <summary>Background</summary>
        <div>
          <Field label="Background colour"><ColorIn value={s.background} onChange={(v) => style({ background: v })} /></Field>
          <Slider label="Background opacity (export transparency)" min={0} max={1} step={0.05} value={s.backgroundOpacity} onChange={(v) => style({ backgroundOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <div className="row">
            <Btn sm icon="image" onClick={pickBg}>Background image…</Btn>
            {s.backgroundImage && <Btn sm kind="ghost" onClick={() => style({ backgroundImage: null })}>Remove</Btn>}
          </div>
          {s.backgroundImage && <Slider label="Image opacity" min={0} max={1} step={0.05} value={s.backgroundImageOpacity} onChange={(v) => style({ backgroundImageOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />}
          <Toggle label="Row stripes" value={s.rowStripe} onChange={(v) => style({ rowStripe: v })} />
          {s.rowStripe && (
            <>
              <ColorIn value={s.rowStripeColor} onChange={(v) => style({ rowStripeColor: v })} />
              <Slider label="Stripe corner radius" min={0} max={24} value={s.rowRadius} onChange={(v) => style({ rowRadius: v })} />
            </>
          )}
        </div>
      </details>
      <details className="sec">
        <summary>Cells, borders & glow</summary>
        <div>
          <Toggle label="Show cell borders (grid)" value={s.showGrid} onChange={(v) => style({ showGrid: v })} />
          <Field label="Cell background"><ColorIn allowTransparent value={s.cellBg} onChange={(v) => style({ cellBg: v })} /></Field>
          <Btn sm kind="ghost" onClick={() => style({ cellBg: "transparent" })}>Transparent cells</Btn>
          <Field label="Border colour"><ColorIn value={s.cellBorderColor} onChange={(v) => style({ cellBorderColor: v })} /></Field>
          <Slider label="Border thickness" min={0} max={8} step={0.5} value={s.cellBorderWidth} onChange={(v) => style({ cellBorderWidth: v })} />
          <Slider label="Rounded corners" min={0} max={30} value={s.cellRadius} onChange={(v) => style({ cellRadius: v })} />
          <Slider label="Glow intensity" min={0} max={1} step={0.05} value={s.glow} onChange={(v) => style({ glow: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Field label="Glow colour">
            <Select value={s.glowMode} onChange={(v) => style({ glowMode: v })} options={[{ value: "row", label: "Variant colour" }, { value: "fixed", label: "Fixed colour" }]} />
          </Field>
          {s.glowMode === "fixed" && <ColorIn value={s.glowColor} onChange={(v) => style({ glowColor: v })} />}
        </div>
      </details>
      <details className="sec">
        <summary>Labels & swatches</summary>
        <div>
          <Toggle label="Colour swatches" value={s.showSwatch} onChange={(v) => style({ showSwatch: v })} />
          {s.showSwatch && <Slider label="Swatch size" min={8} max={64} value={s.swatchSize} onChange={(v) => style({ swatchSize: v })} />}
          <Toggle label="Hex colour labels" value={s.showHex} onChange={(v) => style({ showHex: v })} />
          <Toggle label="Minecraft version label" value={s.showVersion} onChange={(v) => style({ showVersion: v })} />
          {s.showVersion && <TextIn value={s.versionText} onChange={(v) => style({ versionText: v }, "ver")} />}
          <Toggle label="Description footer" value={s.showDescription} onChange={(v) => style({ showDescription: v })} />
          {s.showDescription && <TextIn multiline value={s.description} onChange={(v) => style({ description: v }, "desc")} />}
        </div>
      </details>
      <details className="sec">
        <summary>Animation & sky</summary>
        <div>
          <Slider label="Animation playback speed" min={0.1} max={4} step={0.1} value={s.animSpeed} onChange={(v) => style({ animSpeed: v })} fmt={(v) => `${v.toFixed(1)}×`} />
          <Slider label="Sky time of day" min={0} max={23999} step={250} value={s.skyTime} onChange={(v) => style({ skyTime: v })} fmt={ticksToClock} />
          <div className="row">
            {[["Sunrise", 23000], ["Day", 6000], ["Sunset", 12000], ["Night", 18000]].map(([l, t]) => (
              <Btn key={l} sm onClick={() => style({ skyTime: t as number })}>{l}</Btn>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

export function ticksToClock(t: number) {
  const h = (Math.floor(t / 1000) + 6) % 24;
  const m = Math.floor(((t % 1000) / 1000) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- item picker
function ItemPicker({ sc, mode, onClose, onAdd, onCell }: { sc: Showcase; mode: { mode: "add" } | { mode: "cell"; rowId: string; colId: string }; onClose: () => void; onAdd: (keys: string[]) => void; onCell: (path: string | null) => void }) {
  const packId = mode.mode === "cell" ? sc.rows.find((r) => r.id === mode.rowId)?.packId ?? null : sc.rows.find((r) => r.packId)?.packId ?? null;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatalogCategory | "All" | "Pack files">(mode.mode === "cell" ? "Pack files" : "All");
  const [chosen, setChosen] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!packId) return;
    getPackView(packId).then((v) => setFiles(v.list().filter((f) => /^assets\/[^/]+\/textures\/.+\.png$/.test(f)).sort())).catch(() => setFiles([]));
  }, [packId]);
  const used = new Set(sc.columns.map((c) => c.key));
  const cats: (CatalogCategory | "All" | "Pack files")[] = mode.mode === "cell" ? ["Pack files"] : ["All", "Weapons", "Tools", "Armor", "PvP", "Food", "Blocks", "HUD", "Particles", "Misc", "Pack files"];
  const t = q.trim().toLowerCase();
  const items = useMemo(() => CATALOG.filter((c) => (cat === "All" || c.category === cat) && (!t || c.label.toLowerCase().includes(t) || c.key.includes(t))), [cat, t]);
  const fileList = useMemo(() => files.filter((f) => !t || f.toLowerCase().includes(t)).slice(0, 400), [files, t]);
  const toggle = (k: string) => setChosen(chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k]);
  return (
    <Modal
      wide
      title={mode.mode === "cell" ? "Choose a texture for this cell" : "Add items to the showcase"}
      onClose={onClose}
      footer={
        mode.mode === "add" ? (
          <>
            <Btn onClick={() => onAdd([SKY_COLUMN])} disabled={used.has(SKY_COLUMN)} icon="sky">
              Add sky preview column
            </Btn>
            <div className="grow" />
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>
              Add {chosen.length || ""} item{chosen.length === 1 ? "" : "s"}
            </Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => onCell(null)}>Use auto-detected texture</Btn>
            <Btn onClick={onClose}>Cancel</Btn>
          </>
        )
      }
    >
      <div className="row wrap">
        <div className="search grow">
          <Icon name="search" size={16} />
          <input className="input" autoFocus placeholder="Search textures (e.g. sword, totem, heart)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="row wrap" style={{ gap: 5 }}>
        {cats.map((c) => (
          <button key={c} className={`btn sm ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      {cat !== "Pack files" ? (
        <div className="item-picker">
          {items.map((c) => (
            <div key={c.key} className={`item-tile ${chosen.includes(c.key) ? "on" : ""}`} onClick={() => toggle(c.key)} title={c.key} style={{ opacity: used.has(c.key) ? 0.45 : 1 }}>
              <TextureView packId={packId} itemKey={c.key} size={32} />
              {c.label}
            </div>
          ))}
        </div>
      ) : (
        <>
          <span className="small muted">Every texture inside {packId ? "this pack" : "the pack"} — use this for custom textures that aren't detected automatically. The same path is looked up in each variant's pack.</span>
          <div className="item-picker" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
            {fileList.map((f) => {
              const key = CUSTOM_PREFIX + f;
              return (
                <div key={f} className={`item-tile ${chosen.includes(key) ? "on" : ""}`} title={f} onClick={() => (mode.mode === "cell" ? onCell(f) : toggle(key))}>
                  <TextureView packId={packId} path={f} size={32} />
                  <span style={{ wordBreak: "break-all" }}>{f.split("/").slice(-2).join("/")}</span>
                </div>
              );
            })}
          </div>
          {files.length > fileList.length && <span className="tiny muted">Showing {fileList.length} of {files.length} — refine the search.</span>}
        </>
      )}
    </Modal>
  );
}
