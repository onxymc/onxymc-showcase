import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { PackCard } from "../ui/PackCard";
import { PackDetail } from "./Library";
import { pickPackZips } from "../platform";
import { importSources } from "../core/importer";
import { TARGET_VERSION } from "../core/packMeta";
import type { PackRecord } from "../core/types";

export function Dashboard() {
  const packs = useApp((s) => s.packs);
  const showcases = useApp((s) => s.showcases);
  const categories = useApp((s) => s.categories);
  const setView = useApp((s) => s.setView);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [open, setOpen] = useState<PackRecord | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return packs.filter((p) => (cat === "All" || p.category === cat || (cat === "Favorites" && p.favorite)) && (!t || `${p.name} ${p.description} ${p.packDescription} ${p.author} ${p.tags.join(" ")}`.toLowerCase().includes(t)));
  }, [packs, q, cat]);
  const recent = [...packs].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4);
  const viewed = [...packs].filter((p) => p.lastViewedAt).sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 4);
  const favs = packs.filter((p) => p.favorite).slice(0, 8);
  const featured = packs.filter((p) => p.featured).slice(0, 4);
  const animated = packs.reduce((n, p) => n + p.scan.animatedTextures.length, 0);
  const doImport = async () => {
    const s = await pickPackZips();
    if (s.length) importSources(s);
  };

  const Section = ({ title, list }: { title: string; list: PackRecord[] }) =>
    list.length ? (
      <section className="col" style={{ gap: 10 }}>
        <div className="section-title">{title}</div>
        <div className="pack-grid">{list.map((p) => <PackCard key={p.id} p={p} onOpen={setOpen} />)}</div>
      </section>
    ) : null;

  return (
    <>
      <TopBar title="Dashboard" sub={`Minecraft Java Edition ${TARGET_VERSION}`}>
        <div className="search" style={{ width: 280 }}>
          <Icon name="search" size={16} />
          <input className="input" placeholder="Search packs, tags, authors…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Btn icon="upload" onClick={doImport}>
          Import
        </Btn>
        <Btn kind="primary" icon="creator" onClick={() => setView("creator")}>
          Showcase Creator
        </Btn>
      </TopBar>
      <div className="content">
        <div className="col" style={{ gap: 22 }}>
          <div className="panel sweep" style={{ padding: "22px 24px", display: "flex", alignItems: "center", gap: 20 }}>
            <img src="/icon.png" alt="" width={64} height={64} style={{ borderRadius: 14, boxShadow: "0 0 30px var(--glow)" }} />
            <div className="grow">
              <div style={{ fontSize: 22, fontWeight: 700 }}>OnxyMc Texture Pack Showcase</div>
              <div className="muted">Import, compare, animate and show off your Minecraft resource packs.</div>
            </div>
            <Btn icon="folder" onClick={() => setView("library")}>
              Open Library
            </Btn>
          </div>

          <div className="stat-grid">
            {[
              ["Texture packs", packs.length, "library"],
              ["Showcases", showcases.length, "creator"],
              ["Animated textures", animated, "film"],
              ["Packs with skies", packs.filter((p) => p.scan.skyLayers.length).length, "sky"],
              ["Favorites", packs.filter((p) => p.favorite).length, "star"],
            ].map(([k, v, ic]) => (
              <div className="panel stat" key={k as string}>
                <Icon name={ic as string} className="ico" />
                <div className="v">{v as number}</div>
                <div className="k">{k as string}</div>
              </div>
            ))}
          </div>

          <div className="row wrap" style={{ gap: 6 }}>
            {["All", ...categories].map((c) => (
              <button key={c} className={`btn sm ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>

          {packs.length === 0 ? (
            <div className="panel empty">
              <Icon name="upload" size={42} />
              <h2>No texture packs yet</h2>
              <div>Drag & drop .zip resource packs anywhere in this window, or import them.</div>
              <Btn kind="primary" icon="upload" onClick={doImport}>
                Import texture packs
              </Btn>
            </div>
          ) : q || cat !== "All" ? (
            <Section title={`Results (${filtered.length})`} list={filtered} />
          ) : (
            <>
              <Section title="Featured" list={featured} />
              <Section title="Favorites" list={favs} />
              <Section title="Recently viewed" list={viewed} />
              <Section title="Recently added" list={recent} />
            </>
          )}
        </div>
      </div>
      {open && <PackDetail pack={open} onClose={() => setOpen(null)} />}
    </>
  );
}
