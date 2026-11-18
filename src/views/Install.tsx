import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import { TopBar } from "../App";
import { Btn, confirmDialog } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { listResourcepacks, removeInstalled, openFolder, onInstallProgress, isTauri, type InstalledEntry } from "../platform";
import { installWithPrompts, installFileName, resolveResourcepacksDir } from "../core/install";

export function Install() {
  const packs = useApp((s) => s.packs);
  const dir = useApp((s) => s.settings.resourcepacksDir);
  const [installed, setInstalled] = useState<InstalledEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const refresh = () => (dir ? listResourcepacks(dir).then(setInstalled).catch(() => setInstalled([])) : setInstalled([]));
  useEffect(() => {
    refresh();
  }, [dir]);
  useEffect(() => {
    let un: () => void = () => {};
    onInstallProgress((p) => setProgress((s) => ({ ...s, [p.id]: p.total ? p.copied / p.total : 1 }))).then((u) => (un = u));
    return () => un();
  }, []);
  useEffect(() => {
    if (isTauri && !dir) resolveResourcepacksDir();
  }, []);

  const names = new Set(installed.map((i) => i.name));
  const mine = new Set(packs.map((p) => p.installedAs).filter(Boolean) as string[]);

  return (
    <>
      <TopBar title="Install Packs" sub="Copies packs into Minecraft's resourcepacks folder — Minecraft does not need to be running">
        <Btn icon="refresh" onClick={refresh}>Refresh</Btn>
      </TopBar>
      <div className="content col" style={{ gap: 16 }}>
        {!isTauri && <div className="panel pad chip warn" style={{ height: "auto", padding: 12 }}>Installing requires the Windows desktop app (this is the browser preview).</div>}
        <div className="panel pad">
          <h3>Resource packs folder</h3>
          <div className="row wrap">
            <span className="mono small grow" style={{ wordBreak: "break-all" }}>{dir ?? "Not set"}</span>
            <Btn sm icon="search" onClick={async () => { useApp.getState().setSettings({ resourcepacksDir: null, minecraftDir: null }); const d = await resolveResourcepacksDir(); if (!d) useApp.getState().toast("Minecraft folder not found — choose it manually", "error"); }}>Auto-detect</Btn>
            <Btn sm icon="folder" onClick={() => resolveResourcepacksDir(true)}>Choose folder…</Btn>
            <Btn sm icon="external" disabled={!dir} onClick={() => dir && openFolder(dir)}>Open folder</Btn>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>Default on Windows: %APPDATA%\.minecraft\resourcepacks. For Prism, MultiMC, Modrinth or CurseForge instances, choose that instance's resourcepacks folder.</div>
        </div>
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr><th>Pack</th><th>File</th><th>Status</th><th style={{ width: 280 }}></th></tr>
            </thead>
            <tbody>
              {packs.map((p) => {
                const file = installFileName(p);
                const isIn = names.has(file);
                const prog = progress[p.id];
                return (
                  <tr key={p.id}>
                    <td><div className="row">{p.iconDataUrl && <img src={p.iconDataUrl} width={26} height={26} className="pixel" style={{ borderRadius: 5 }} alt="" />}<b>{p.name}</b></div></td>
                    <td className="mono tiny">{file}</td>
                    <td>
                      {prog != null && prog < 1 ? (
                        <div className="progress" style={{ width: 120 }}><div style={{ width: `${prog * 100}%` }} /></div>
                      ) : isIn ? <span className="chip ok">Installed</span> : p.sourcePath.startsWith("blob:") ? <span className="chip">No file on disk</span> : <span className="chip">Not installed</span>}
                    </td>
                    <td>
                      <div className="row">
                        <Btn sm icon="install" disabled={!dir || !isTauri} onClick={async () => { await installWithPrompts(p, dir!); refresh(); }}>{isIn ? "Reinstall" : "Install"}</Btn>
                        {isIn && (
                          <Btn sm kind="danger" icon="trash" disabled={!mine.has(file)} title={mine.has(file) ? "Remove the installed copy" : "Only copies installed by this app can be removed here"} onClick={async () => {
                            if (!(await confirmDialog("Remove installed copy?", `“${file}” will be deleted from the resourcepacks folder. Your original pack and library entry are kept.`, "Remove", { danger: true }))) return;
                            try {
                              await removeInstalled(dir!, file);
                              useApp.getState().updatePack(p.id, { installedAs: null });
                              useApp.getState().toast(`Removed ${file}`, "success");
                            } catch (e: any) {
                              useApp.getState().toast(`Could not remove: ${e?.message ?? e}`, "error");
                            }
                            refresh();
                          }}>Remove</Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!packs.length && <div className="empty"><Icon name="install" size={36} />Import packs first.</div>}
        </div>
        {installed.length > 0 && (
          <div className="panel pad">
            <h3>Currently in the folder ({installed.length})</h3>
            <div className="row wrap" style={{ gap: 6 }}>
              {installed.map((i) => <span key={i.name} className={`chip ${mine.has(i.name) ? "accent" : ""}`} title={i.is_dir ? "Folder" : `${(i.size / 1048576).toFixed(1)} MB`}>{i.is_dir ? "📁 " : ""}{i.name}</span>)}
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>Highlighted entries were installed by this app. Other files are never touched.</div>
          </div>
        )}
      </div>
    </>
  );
}
