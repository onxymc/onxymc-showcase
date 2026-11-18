import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, Field, Modal, Select, TextIn, Toggle, confirmDialog } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { PackCard, openShowcaseFor } from "../ui/PackCard";
import { pickPackFolder, pickPackZips, saveBytes, deleteBrowserSource, isTauri } from "../platform";
import { importSources, refreshPack, blobToDataUrl } from "../core/importer";
import { invalidatePack, decodePng } from "../core/packAccess";
import { installWithPrompts } from "../core/install";
import type { PackLinks, PackRecord } from "../core/types";
import { normalizeShowcase, uid } from "../core/showcase";
import { usePointerReorder, moveInList } from "../ui/usePointerReorder";

type Sort = "custom" | "name" | "added" | "viewed" | "format";

export function Library() {
  const packs = useApp((s) => s.packs);
  const categories = useApp((s) => s.categories);
  const viewMode = useApp((s) => s.settings.libraryView);
  const setSettings = useApp((s) => s.setSettings);
  const focus = useApp((s) => s.focusPackId);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("custom");
  const [open, setOpen] = useState<PackRecord | null>(null);
  useEffect(() => {
    if (focus) {
      const p = useApp.getState().packs.find((x) => x.id === focus);
      if (p) setOpen(p);
      useApp.getState().setFocusPack(null);
    }
  }, [focus]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = packs.filter((p) => (cat === "All" || p.category === cat || (cat === "Favorites" && p.favorite)) && (!t || `${p.name} ${p.description} ${p.packDescription} ${p.author} ${p.tags.join(" ")} ${p.category}`.toLowerCase().includes(t)));
    const by: Record<Sort, (a: PackRecord, b: PackRecord) => number> = {
      custom: (a, b) => a.order - b.order,
      name: (a, b) => a.name.localeCompare(b.name),
      added: (a, b) => b.addedAt - a.addedAt,
      viewed: (a, b) => b.lastViewedAt - a.lastViewedAt,
      format: (a, b) => (b.format.maxFormat ?? 0) - (a.format.maxFormat ?? 0),
    };
    return l.sort(by[sort]);
  }, [packs, q, cat, sort]);

  const importZips = async () => {
    const s = await pickPackZips();
    if (s.length) importSources(s);
  };
  const importFolder = async () => {
    const s = await pickPackFolder();
    if (s) importSources([s]);
  };

  return (
    <>
      <TopBar title="Texture Pack Library" sub={`${packs.length} packs · originals are never modified`}>
        <Btn icon="upload" kind="primary" onClick={importZips}>
          Import ZIPs
        </Btn>
        <Btn icon="folder" onClick={importFolder}>
          Import folder
        </Btn>
        <MetadataMenu />
      </TopBar>
      <div className="content" style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 0 }}>
        <div className="row wrap">
          <div className="search" style={{ width: 300 }}>
            <Icon name="search" size={16} />
            <input className="input" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" />
          </div>
          <div style={{ width: 170 }}>
            <Select value={cat} onChange={setCat} options={["All", ...categories].map((c) => ({ value: c, label: c === "All" ? "All categories" : c }))} />
          </div>
          <div style={{ width: 170 }}>
            <Select<Sort>
              value={sort}
              onChange={setSort}
              options={[
                { value: "custom", label: "Custom order" },
                { value: "name", label: "Name" },
                { value: "added", label: "Recently added" },
                { value: "viewed", label: "Recently viewed" },
                { value: "format", label: "Newest format" },
              ]}
            />
          </div>
          <div className="spacer grow" />
          <Btn iconOnly icon="grid" title="Grid view" on={viewMode === "grid"} onClick={() => setSettings({ libraryView: "grid" })} />
          <Btn iconOnly icon="list" title="List view" on={viewMode === "list"} onClick={() => setSettings({ libraryView: "list" })} />
        </div>
        {packs.length === 0 ? (
          <div className="panel empty">
            <Icon name="library" size={42} />
            <h2>Your library is empty</h2>
            <div>Import resource pack .zip files or extracted pack folders. Drag & drop works too.</div>
            <div className="row">
              <Btn kind="primary" icon="upload" onClick={importZips}>
                Import ZIPs
              </Btn>
              <Btn icon="folder" onClick={importFolder}>
                Import folder
              </Btn>
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <VirtualGrid items={list} onOpen={setOpen} />
        ) : (
          <VirtualList items={list} onOpen={setOpen} draggable={sort === "custom" && !q && cat === "All"} />
        )}
      </div>
      {open && <PackDetail pack={packs.find((p) => p.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  );
}

function VirtualGrid({ items, onOpen }: { items: PackRecord[]; onOpen: (p: PackRecord) => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (parent.current) ro.observe(parent.current);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((width + 14) / (250 + 14)));
  const rows = Math.ceil(items.length / cols);
  const v = useVirtualizer({ count: rows, getScrollElement: () => parent.current, estimateSize: () => 290, overscan: 2 });
  return (
    <div ref={parent} style={{ flex: 1, overflow: "auto", minHeight: 0, paddingBottom: 30 }}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((r) => (
          <div key={r.key} ref={v.measureElement} data-index={r.index} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${r.start}px)`, paddingBottom: 14 }}>
            <div className="pack-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {items.slice(r.index * cols, r.index * cols + cols).map((p) => (
                <PackCard key={p.id} p={p} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VirtualList({ items, onOpen, draggable }: { items: PackRecord[]; onOpen: (p: PackRecord) => void; draggable: boolean }) {
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => 60, overscan: 6 });
  const reorder = useApp((s) => s.reorderPacks);
  const update = useApp((s) => s.updatePack);
  const { itemProps } = usePointerReorder((from, to, after) => reorder(moveInList(items, from, to, after).map((p) => p.id)), draggable);
  return (
    <div ref={parent} className="panel" style={{ flex: 1, overflow: "auto", minHeight: 0, marginBottom: 24 }}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((r) => {
          const p = items[r.index];
          return (
            <div
              key={p.id}
              {...itemProps(p.id)}
              className={`pack-list-row ${itemProps(p.id).className}`}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${r.start}px)` }}
              onClick={() => onOpen(p)}
            >
              {p.iconDataUrl ? <img className="icon" src={p.iconDataUrl} alt="" /> : <div />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.description || p.packDescription}
                </div>
              </div>
              <span className="chip">{p.format.versionLabel}</span>
              <div>{p.previewDataUrl && <img src={p.previewDataUrl} alt="" className="pixel" style={{ height: 28 }} />}</div>
              <span className="chip">{p.category}</span>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                <Btn sm iconOnly icon="star" title="Favorite" on={p.favorite} onClick={() => update(p.id, { favorite: !p.favorite })} />
                <Btn sm iconOnly icon="eye" title="View showcase" onClick={() => openShowcaseFor(p)} />
                <Btn sm iconOnly icon="install" title="Install" onClick={() => installWithPrompts(p)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- metadata export / import
function MetadataMenu() {
  const [open, setOpen] = useState(false);
  const exportMeta = async () => {
    const st = useApp.getState();
    const data = { app: "onxymc-showcase", kind: "library-metadata", version: 1, exportedAt: new Date().toISOString(), categories: st.categories, packs: st.packs, showcases: st.showcases, templates: st.customTemplates };
    const path = await saveBytes("onxymc-library.json", new TextEncoder().encode(JSON.stringify(data, null, 2)), [{ name: "JSON", extensions: ["json"] }], st.settings.exportDir ?? undefined);
    if (path) st.toast("Library metadata exported", "success");
    setOpen(false);
  };
  const importMeta = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = ".json,application/json";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      const st = useApp.getState();
      try {
        if (f.size > 64 * 1024 * 1024) throw new Error("file too large");
        const data = JSON.parse(await f.text());
        if (data?.app !== "onxymc-showcase") throw new Error("not an OnxyMc library export");
        let n = 0;
        for (const p of Array.isArray(data.packs) ? data.packs : []) {
          if (!p || typeof p.id !== "string" || typeof p.sourcePath !== "string" || !p.scan || !p.format) continue;
          const existing = st.packs.find((x) => x.id === p.id || x.sourcePath === p.sourcePath);
          useApp.getState().upsertPack({ ...p, id: existing?.id ?? p.id, links: sanitizeLinks(p.links ?? {}) });
          n++;
        }
        for (const s of Array.isArray(data.showcases) ? data.showcases : []) {
          const sc = normalizeShowcase(s);
          if (sc) useApp.getState().upsertShowcase(sc);
        }
        if (Array.isArray(data.categories)) st.setCategories([...new Set([...st.categories, ...data.categories.filter((c: any) => typeof c === "string")])]);
        st.toast(`Imported metadata for ${n} packs`, "success");
      } catch (e: any) {
        st.toast(`Could not import metadata: ${e.message ?? e}`, "error");
      }
    };
    i.click();
    setOpen(false);
  };
  return (
    <div style={{ position: "relative" }}>
      <Btn icon="layers" onClick={() => setOpen(!open)}>
        Metadata
      </Btn>
      {open && (
        <div className="panel pad col" style={{ position: "absolute", right: 0, top: 40, zIndex: 20, width: 230, gap: 6 }}>
          <Btn icon="download" onClick={exportMeta}>
            Export library metadata
          </Btn>
          <Btn icon="upload" onClick={importMeta}>
            Import library metadata
          </Btn>
        </div>
      )}
    </div>
  );
}

export function sanitizeLinks(l: Record<string, unknown>): PackLinks {
  const out: PackLinks = {};
  for (const k of ["download", "modrinth", "curseforge", "github", "youtube", "discord"] as const) {
    const v = l[k];
    if (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

// ---------------------------------------------------------------- pack detail
export function PackDetail({ pack, onClose }: { pack: PackRecord; onClose: () => void }) {
  const update = useApp((s) => s.updatePack);
  const categories = useApp((s) => s.categories);
  const setCategories = useApp((s) => s.setCategories);
  const p = useApp((s) => s.packs.find((x) => x.id === pack.id)) ?? pack;
  const [tag, setTag] = useState("");
  const [newCat, setNewCat] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({ ...p.links } as any);
  const setLink = (k: string, v: string) => setLinks({ ...links, [k]: v });
  const commitLinks = () => {
    const bad = Object.entries(links).filter(([, v]) => v && !/^https:\/\/[^\s]+$/i.test(v.trim()));
    if (bad.length) useApp.getState().toast(`Links must start with https:// (${bad.map(([k]) => k).join(", ")})`, "error");
    update(p.id, { links: sanitizeLinks(links) });
  };

  const pickThumb = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/png";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      try {
        const bmp = await decodePng(new Uint8Array(await f.arrayBuffer()));
        const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
        const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        update(p.id, { customThumbnail: await blobToDataUrl(await c.convertToBlob({ type: "image/png" })) });
      } catch (e: any) {
        useApp.getState().toast(`Thumbnail rejected: ${e.message}`, "error");
      }
    };
    i.click();
  };

  const remove = async () => {
    const ok = await confirmDialog("Remove from library?", `“${p.name}” will be removed from the library. ${isTauri ? "The original file on disk is not deleted." : ""}`, "Remove", { danger: true });
    if (!ok) return;
    invalidatePack(p.id);
    if (p.sourcePath.startsWith("blob:")) await deleteBrowserSource(p.sourcePath);
    useApp.getState().removePack(p.id);
    onClose();
  };

  return (
    <Modal
      wide
      title={p.name}
      onClose={onClose}
      footer={
        <>
          <Btn kind="danger" icon="trash" onClick={remove}>
            Remove from library
          </Btn>
          <div className="grow" />
          <Btn icon="refresh" onClick={() => refreshPack(p.id)}>
            Refresh
          </Btn>
          <Btn icon="install" onClick={() => installWithPrompts(p)}>
            Install
          </Btn>
          <Btn kind="primary" icon="eye" onClick={() => openShowcaseFor(p)}>
            View Showcase
          </Btn>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="col">
          <Field label="Library name (does not rename the file)">
            <TextIn value={p.name} onChange={(v) => update(p.id, { name: v })} />
          </Field>
          <Field label="Description">
            <TextIn multiline value={p.description} placeholder={p.packDescription || "Add a description"} onChange={(v) => update(p.id, { description: v })} />
          </Field>
          <div className="grid2">
            <Field label="Author">
              <TextIn value={p.author} onChange={(v) => update(p.id, { author: v })} />
            </Field>
            <Field label="Category">
              <Select value={p.category} onChange={(v) => update(p.id, { category: v })} options={[...new Set([...categories, p.category])].map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <div className="row">
            <input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <Btn
              sm
              icon="plus"
              disabled={!newCat.trim()}
              onClick={() => {
                const c = newCat.trim();
                setCategories([...new Set([...categories, c])]);
                update(p.id, { category: c });
                setNewCat("");
              }}
            >
              Add
            </Btn>
          </div>
          <Field label="Tags">
            <div className="row wrap" style={{ gap: 5 }}>
              {p.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                  <button onClick={() => update(p.id, { tags: p.tags.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                className="input"
                style={{ width: 140, height: 26 }}
                placeholder="add tag + Enter"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tag.trim()) {
                    update(p.id, { tags: [...new Set([...p.tags, tag.trim()])] });
                    setTag("");
                  }
                }}
              />
            </div>
          </Field>
          <div className="row" style={{ gap: 20 }}>
            <Toggle label="Favorite" value={p.favorite} onChange={(v) => update(p.id, { favorite: v })} />
            <Toggle label="Featured on dashboard" value={p.featured} onChange={(v) => update(p.id, { featured: v })} />
          </div>
          <div className="row">
            <Btn sm icon="image" onClick={pickThumb}>
              Custom thumbnail
            </Btn>
            {p.customThumbnail && (
              <Btn sm kind="ghost" onClick={() => update(p.id, { customThumbnail: null })}>
                Reset thumbnail
              </Btn>
            )}
            <Btn
              sm
              icon="copy"
              onClick={() => {
                const st = useApp.getState();
                const src = st.showcases.find((s) => s.rows.some((r) => r.packId === p.id));
                if (!src) return st.toast("No showcase uses this pack yet", "info");
                st.upsertShowcase({ ...structuredClone(src), id: uid(), name: `${src.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() });
                st.toast("Showcase configuration duplicated", "success");
              }}
            >
              Duplicate showcase config
            </Btn>
          </div>
        </div>
        <div className="col">
          <div className="panel pad" style={{ background: "rgba(0,0,0,.25)" }}>
            <h3>Pack information</h3>
            <table className="tbl">
              <tbody>
                <tr><td className="muted">Source</td><td className="mono tiny" style={{ wordBreak: "break-all" }}>{p.sourcePath.startsWith("blob:") ? "Stored in app (browser mode)" : p.sourcePath}</td></tr>
                <tr><td className="muted">Type</td><td>{p.sourceKind === "folder" ? "Folder" : "ZIP archive"} · {(p.sourceSize / 1048576).toFixed(2)} MB</td></tr>
                <tr><td className="muted">Version</td><td>{p.format.versionLabel} {p.format.packFormat != null && <span className="muted tiny">(pack_format {p.format.packFormat})</span>}</td></tr>
                <tr><td className="muted">1.21.11</td><td>{p.format.supports12111 === true ? <span className="chip ok">Supported</span> : p.format.supports12111 === false ? <span className="chip warn">Made for another version</span> : "Unknown"}</td></tr>
                <tr><td className="muted">Textures</td><td>{p.scan.textureCount} ({p.scan.itemTextures} item, {p.scan.blockTextures} block)</td></tr>
                <tr><td className="muted">Animated</td><td>{p.scan.animatedTextures.length}</td></tr>
                <tr><td className="muted">Item models</td><td>{p.scan.customItemModelCount} {p.scan.hasItemDefinitions && "· item definitions (1.21.4+)"} {p.scan.hasCIT && "· CIT (OptiFine)"}</td></tr>
                <tr><td className="muted">Custom sky</td><td>{p.scan.skyLayers.length ? `${p.scan.skyLayers.length} layer(s) (Skyboxify/OptiFine)` : "None"}</td></tr>
                {p.scan.rootPrefix && <tr><td className="muted">Root folder</td><td className="mono tiny">{p.scan.rootPrefix}</td></tr>}
              </tbody>
            </table>
            {p.packDescription && <div className="small muted" style={{ marginTop: 8 }}>“{p.packDescription}”</div>}
            {p.scan.warnings.length > 0 && (
              <div className="col" style={{ gap: 4, marginTop: 10 }}>
                {p.scan.warnings.slice(0, 6).map((w, i) => (
                  <span key={i} className="chip warn" style={{ whiteSpace: "normal", height: "auto", padding: "3px 8px" }}>
                    {w}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="panel pad" style={{ background: "rgba(0,0,0,.25)" }}>
            <h3>Links</h3>
            <div className="col" style={{ gap: 8 }}>
              {(["download", "modrinth", "curseforge", "github", "youtube", "discord"] as const).map((k) => (
                <div className="row" key={k}>
                  <span className="small muted" style={{ width: 80, textTransform: "capitalize" }}>{k}</span>
                  <input className="input" placeholder="https://…" value={links[k] ?? ""} onChange={(e) => setLink(k, e.target.value)} onBlur={commitLinks} />
                </div>
              ))}
              <span className="tiny muted">Only https:// links are accepted. The Download button is hidden until a download URL is set.</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
