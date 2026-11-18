import { memo } from "react";
import type { PackRecord } from "../core/types";
import { useApp } from "../state/store";
import { Icon } from "./Icon";
import { Btn } from "./controls";
import { installWithPrompts } from "../core/install";
import { openExternal } from "../platform";
import { newShowcase } from "../core/showcase";

export function openShowcaseFor(p: PackRecord) {
  const st = useApp.getState();
  st.updatePack(p.id, { lastViewedAt: Date.now() });
  const existing = st.showcases.find((s) => s.rows.length === 1 && s.rows[0].packId === p.id);
  const sc = existing ?? newShowcase(`${p.name} Showcase`, "modern-dark", [{ id: p.id, name: p.name, color: p.accentColor }]);
  if (!existing) st.upsertShowcase(sc);
  st.setActiveShowcase(sc.id);
  st.setView("creator");
}

export const PackCard = memo(function PackCard({ p, onOpen }: { p: PackRecord; onOpen: (p: PackRecord) => void }) {
  const update = useApp((s) => s.updatePack);
  const thumb = p.customThumbnail ?? p.previewDataUrl;
  return (
    <div className="panel pack-card" onClick={() => onOpen(p)} data-pack={p.name}>
      <div className="preview">
        {thumb ? <img src={thumb} alt="" /> : <span className="muted small">No item textures</span>}
        <button
          className={`btn ghost sm icon fav ${p.favorite ? "on" : ""}`}
          title={p.favorite ? "Unfavorite" : "Favorite"}
          onClick={(e) => {
            e.stopPropagation();
            update(p.id, { favorite: !p.favorite });
          }}
        >
          <Icon name="star" size={16} />
        </button>
      </div>
      <div className="body">
        <div className="head">
          {p.iconDataUrl ? <img className="icon" src={p.iconDataUrl} alt="" /> : <div className="icon" />}
          <div style={{ minWidth: 0 }}>
            <div className="name" title={p.name}>
              {p.name}
            </div>
            <div className="tiny muted">{p.author ? `by ${p.author}` : p.originalName}</div>
          </div>
        </div>
        <div className="desc">{p.description || p.packDescription || "No description"}</div>
        <div className="row wrap" style={{ gap: 5 }}>
          <span className={`chip ${p.format.supports12111 === true ? "ok" : p.format.supports12111 === false ? "warn" : ""}`}>{p.format.versionLabel}</span>
          <span className="chip">{p.category}</span>
          {p.scan.animatedTextures.length > 0 && <span className="chip accent">{p.scan.animatedTextures.length} animated</span>}
          {p.scan.skyLayers.length > 0 && <span className="chip">Sky</span>}
        </div>
      </div>
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        <Btn sm kind="primary" icon="eye" onClick={() => openShowcaseFor(p)}>
          View Showcase
        </Btn>
        <Btn sm icon="install" title="Install into Minecraft" onClick={() => installWithPrompts(p)}>
          Install
        </Btn>
        {p.links.download && <Btn sm iconOnly icon="download" title="Open download link" onClick={() => openExternal(p.links.download!).catch((e) => useApp.getState().toast(String(e), "error"))} />}
      </div>
    </div>
  );
});
