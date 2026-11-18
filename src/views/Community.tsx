import { useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { openExternal } from "../platform";

const LABELS: Record<string, [string, string]> = {
  discord: ["Discord community", "discord"],
  modrinth: ["Modrinth", "download"],
  curseforge: ["CurseForge", "download"],
  github: ["GitHub", "external"],
  youtube: ["YouTube", "play"],
  website: ["Website", "link"],
};

export function Community() {
  const links = useApp((s) => s.settings.links);
  const setSettings = useApp((s) => s.setSettings);
  const packs = useApp((s) => s.packs);
  const [draft, setDraft] = useState(links);
  const open = (u: string) => openExternal(u).catch((e) => useApp.getState().toast(String(e?.message ?? e), "error"));
  const valid = (u: string) => !u || /^https:\/\/[^\s]+$/i.test(u.trim());
  const save = () => {
    const bad = Object.entries(draft).filter(([, v]) => !valid(v));
    if (bad.length) return useApp.getState().toast("Links must start with https://", "error");
    setSettings({ links: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()])) as any });
    useApp.getState().toast("Links saved", "success");
  };
  const packLinks = packs.filter((p) => Object.values(p.links).some(Boolean));
  return (
    <>
      <TopBar title="Downloads & Community" sub="Your links — nothing here is invented; empty links stay hidden" />
      <div className="content col" style={{ gap: 16 }}>
        {links.discord && (
          <div className="panel sweep" style={{ padding: 22, display: "flex", alignItems: "center", gap: 18 }}>
            <Icon name="discord" size={40} style={{ color: "var(--accent)" }} />
            <div className="grow">
              <div style={{ fontSize: 18, fontWeight: 700 }}>Join the OnxyMc Discord</div>
              <div className="muted small mono">{links.discord}</div>
            </div>
            <Btn kind="primary" icon="external" onClick={() => open(links.discord)}>Open invite</Btn>
          </div>
        )}
        <div className="panel pad col">
          <h3>Your links</h3>
          {(Object.keys(LABELS) as (keyof typeof links)[]).map((k) => (
            <div className="link-row" key={k}>
              <Icon name={LABELS[k][1]} />
              <span className="small">{LABELS[k][0]}</span>
              <input className="input" style={{ borderColor: valid(draft[k]) ? undefined : "#a33" }} placeholder="https://…" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              <Btn sm iconOnly icon="external" title="Open" disabled={!links[k]} onClick={() => open(links[k])} />
            </div>
          ))}
          <div className="row"><div className="grow" /><Btn kind="primary" icon="save" onClick={save}>Save links</Btn></div>
        </div>
        <div className="panel pad col">
          <h3>Pack downloads</h3>
          {packLinks.length === 0 && <div className="small muted">No pack has download links yet. Add them from a pack's details in the Library — Download buttons only appear for packs with a configured URL.</div>}
          {packLinks.map((p) => (
            <div key={p.id} className="row wrap" style={{ gap: 8, padding: "6px 0", borderBottom: "1px solid var(--panel-border)" }}>
              <b className="grow">{p.name}</b>
              {Object.entries(p.links).filter(([, v]) => v).map(([k, v]) => (
                <Btn key={k} sm icon={k === "download" ? "download" : "external"} onClick={() => open(v!)}>{k}</Btn>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
