import { useEffect, useState } from "react";
import { useApp, DEFAULT_SETTINGS } from "../state/store";
import { TopBar, APP_VERSION } from "../App";
import { Btn, Field, Slider, Tabs, Toggle, confirmDialog } from "../ui/controls";
import { clearTextureCache, textureCacheStats } from "../core/packAccess";
import { clearSkyCache } from "../render/showcaseData";
import { clockStats } from "../render/clock";
import { detectMinecraftDir, pickDirectory, isTauri, storeRead } from "../platform";
import { TARGET_VERSION, TARGET_FORMAT } from "../core/packMeta";
import { normalizeShowcase } from "../core/showcase";

type Tab = "general" | "performance" | "data" | "about";

export function SettingsView() {
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const [tab, setTab] = useState<Tab>("general");
  const [stats, setStats] = useState(textureCacheStats());
  useEffect(() => {
    const i = setInterval(() => setStats(textureCacheStats()), 1000);
    return () => clearInterval(i);
  }, []);
  const PathRow = ({ label, value, onPick, onClear }: { label: string; value: string | null; onPick: () => void; onClear?: () => void }) => (
    <Field label={label}>
      <div className="row">
        <span className="mono small grow" style={{ wordBreak: "break-all" }}>{value ?? "Not set"}</span>
        <Btn sm icon="folder" disabled={!isTauri} onClick={onPick}>Choose…</Btn>
        {onClear && value && <Btn sm kind="ghost" onClick={onClear}>Clear</Btn>}
      </div>
    </Field>
  );
  const restoreBackup = async () => {
    for (let i = 0; i < s.backupKeep; i++) {
      const t = await storeRead(`backup-showcases-${i}`).catch(() => null);
      if (!t) continue;
      try {
        const d = JSON.parse(t);
        const list = (d.data?.showcases ?? []).map(normalizeShowcase).filter(Boolean);
        if (!(await confirmDialog("Restore showcase backup?", `Backup slot ${i + 1} from ${new Date(d.savedAt).toLocaleString()} contains ${list.length} showcases. Showcases with the same id will be replaced.`, "Restore", { extra: i + 1 < s.backupKeep ? [{ label: "Try next slot", value: "next" }] : [] })))
          return;
        const st = useApp.getState();
        for (const sc of list) st.upsertShowcase(sc);
        return st.toast(`Restored ${list.length} showcases`, "success");
      } catch {
        /* try the next slot */
      }
    }
    useApp.getState().toast("No backups found yet", "info");
  };
  return (
    <>
      <TopBar title="Settings" sub="Saved locally and restored automatically">
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ value: "general", label: "General" }, { value: "performance", label: "Performance" }, { value: "data", label: "Data & backups" }, { value: "about", label: "About" }]} />
      </TopBar>
      <div className="content" style={{ maxWidth: 860 }}>
        {tab === "general" && (
          <div className="panel pad col">
            <PathRow label="Minecraft installation" value={s.minecraftDir} onPick={async () => { const d = await pickDirectory("Minecraft folder (.minecraft)"); if (d) set({ minecraftDir: d, resourcepacksDir: `${d}${d.includes("\\") ? "\\" : "/"}resourcepacks` }); }} />
            <Btn sm onClick={async () => { const d = await detectMinecraftDir(); if (d) { set({ minecraftDir: d, resourcepacksDir: `${d}${d.includes("\\") ? "\\" : "/"}resourcepacks` }); useApp.getState().toast("Minecraft folder detected", "success"); } else useApp.getState().toast("Standard .minecraft folder not found", "error"); }}>Auto-detect Minecraft</Btn>
            <PathRow label="Resource packs folder (install target)" value={s.resourcepacksDir} onPick={async () => { const d = await pickDirectory(); if (d) set({ resourcepacksDir: d }); }} />
            <PathRow label="Default import folder" value={s.importDir} onPick={async () => { const d = await pickDirectory(); if (d) set({ importDir: d }); }} onClear={() => set({ importDir: null })} />
            <PathRow label="Default export folder" value={s.exportDir} onPick={async () => { const d = await pickDirectory(); if (d) set({ exportDir: d }); }} onClear={() => set({ exportDir: null })} />
            <div className="hr" />
            <Toggle label="Play texture animations" value={s.animationsEnabled} onChange={(v) => set({ animationsEnabled: v })} />
            <Slider label="Global animation speed" min={0.1} max={4} step={0.1} value={s.animationSpeed} onChange={(v) => set({ animationSpeed: v })} fmt={(v) => `${v.toFixed(1)}×`} />
            <div className="hr" />
            <Toggle label="Check for updates on startup" value={s.checkUpdates} onChange={(v) => set({ checkUpdates: v })} />
            <span className="tiny muted">No update server is configured in this build, so no network request is made. The preference is stored for when one is.</span>
          </div>
        )}
        {tab === "performance" && (
          <div className="panel pad col">
            <Slider label="Preview frame-rate limit (Minecraft animations update at 20/s)" min={2} max={20} value={s.maxPreviewFps} onChange={(v) => set({ maxPreviewFps: v })} fmt={(v) => `${v} fps`} />
            <Toggle label="Pause animations that are off-screen" value={s.pauseOffscreen} onChange={(v) => set({ pauseOffscreen: v })} />
            <Toggle label="Reduce animation quality (pauses all texture animation)" value={!s.animationsEnabled} onChange={(v) => set({ animationsEnabled: !v })} />
            <Toggle label="Disable decorative effects" value={!s.effects} onChange={(v) => set({ effects: !v })} />
            <Toggle label="Disable background particles" value={!s.backgroundFx} onChange={(v) => set({ backgroundFx: !v })} />
            <div className="hr" />
            <Slider label="Texture cache budget" min={32} max={2048} step={32} value={s.textureCacheMB} onChange={(v) => set({ textureCacheMB: v })} fmt={(v) => `${v} MB`} />
            <div className="row small">
              <span className="grow muted">Cache: {stats.entries} textures · {stats.usedMB.toFixed(1)} / {stats.budgetMB.toFixed(0)} MB decoded · animation clock {clockStats().running ? `running (${clockStats().subscribers} visible)` : "idle"}</span>
              <Btn sm icon="trash" onClick={() => { clearTextureCache(); clearSkyCache(); setStats(textureCacheStats()); useApp.getState().toast("Texture cache cleared", "success"); }}>Clear cache</Btn>
            </div>
            <span className="tiny muted">Textures are decoded only when shown, kept in a size-limited cache, and evicted least-recently-used first.</span>
          </div>
        )}
        {tab === "data" && (
          <div className="panel pad col">
            <Toggle label="Automatic showcase project backups" value={s.autoBackup} onChange={(v) => set({ autoBackup: v })} />
            <Slider label="Backup slots kept (rotating, every 10 minutes of editing)" min={1} max={20} value={s.backupKeep} onChange={(v) => set({ backupKeep: v })} />
            <Btn sm icon="restart" onClick={restoreBackup}>Restore from backup…</Btn>
            <div className="hr" />
            <span className="small muted">Library, showcases and settings are written atomically (temporary file + rename) with a .bak copy; a corrupted file falls back to its backup automatically.</span>
            <Btn sm kind="danger" icon="refresh" onClick={async () => { if (await confirmDialog("Reset all settings?", "Settings return to defaults. Your library and showcases are not affected.", "Reset", { danger: true })) set(DEFAULT_SETTINGS); }}>Reset settings to defaults</Btn>
          </div>
        )}
        {tab === "about" && (
          <div className="panel pad col sweep">
            <div className="row" style={{ gap: 16 }}>
              <img src="/icon.png" width={72} height={72} style={{ borderRadius: 16, boxShadow: "0 0 30px var(--glow)" }} alt="" />
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>OnxyMc Texture Pack Showcase</div>
                <div className="muted">Version {APP_VERSION} · targets Minecraft Java {TARGET_VERSION} (resource pack format {TARGET_FORMAT})</div>
              </div>
            </div>
            <div className="small muted">
              Built with Tauri, React, TypeScript, Rust and three.js. Custom sky support follows the Skyboxify (OptiFine-compatible) format. Imported packs are treated as untrusted and are never modified or executed.
              Minecraft is a trademark of Mojang AB; this app is not affiliated with Mojang or Microsoft. No Minecraft assets are bundled — all previews come from the packs you import.
            </div>
            <div className="small">Runtime: {isTauri ? "Desktop (Tauri)" : "Browser preview"}</div>
          </div>
        )}
      </div>
    </>
  );
}
