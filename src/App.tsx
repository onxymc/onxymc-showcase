import { useEffect, useState, lazy, Suspense } from "react";
import { useApp, themeColors, type ViewId } from "./state/store";
import { applyTheme } from "./state/themes";
import { Icon } from "./ui/Icon";
import { ConfirmHost } from "./ui/controls";
import { FxCanvas } from "./ui/FxCanvas";
import { configureClock } from "./render/clock";
import { setTextureBudgetMB } from "./core/packAccess";
import { importSources } from "./core/importer";
import { onFileDrop, pathToSource, fileToSource, isTauri } from "./platform";
import { TARGET_VERSION } from "./core/packMeta";
import { Dashboard } from "./views/Dashboard";
import { Library } from "./views/Library";
import { Creator } from "./views/Creator";
import { Animations } from "./views/Animations";
import { Install } from "./views/Install";
import { Community } from "./views/Community";
import { Appearance } from "./views/Appearance";
import { SettingsView } from "./views/Settings";

// Three.js is only loaded when the 3D tab is opened.
const Models3D = lazy(() => import("./views/Models3D"));
const Skybox = lazy(() => import("./views/Skybox"));

export const APP_VERSION = "1.0.0";

const NAV: { group?: string; id: ViewId; label: string; icon: string }[] = [
  { group: "Overview", id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "library", label: "Pack Library", icon: "library" },
  { group: "Create", id: "creator", label: "Showcase Creator", icon: "creator" },
  { id: "animations", label: "Animations", icon: "film" },
  { id: "models", label: "3D Preview", icon: "cube" },
  { id: "skybox", label: "Skybox Preview", icon: "sky" },
  { group: "Share", id: "install", label: "Install Packs", icon: "install" },
  { id: "community", label: "Downloads & Links", icon: "link" },
  { group: "App", id: "appearance", label: "Appearance", icon: "palette" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const settings = useApp((s) => s.settings);
  const packs = useApp((s) => s.packs.length);
  const showcases = useApp((s) => s.showcases.length);
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const importing = useApp((s) => s.importing);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    applyTheme(themeColors(settings), { effects: settings.effects, reduceMotion: settings.reduceMotion });
    document.documentElement.dataset.pixelUi = settings.pixelUiFont ? "on" : "off";
    document.documentElement.dataset.sweep = settings.lightSweep ? "on" : "off";
    configureClock({ speed: settings.animationSpeed, enabled: settings.animationsEnabled, maxFps: settings.maxPreviewFps });
    setTextureBudgetMB(settings.textureCacheMB);
  }, [settings]);

  // Drag & drop import (desktop gives paths; browser gives File objects)
  useEffect(() => {
    let un: (() => void) | undefined;
    onFileDrop(
      async (paths) => {
        const srcs = await Promise.all(paths.map(pathToSource));
        const ok = srcs.filter((s) => s.kind === "folder" || /\.zip$/i.test(s.name));
        if (ok.length) importSources(ok);
        else useApp.getState().toast("Drop .zip resource packs or pack folders", "error");
      },
      setDragOver,
    ).then((u) => (un = u));
    if (isTauri) return () => un?.();
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.zip$/i.test(f.name));
      if (files.length) importSources(files.map(fileToSource));
      else useApp.getState().toast("Drop .zip resource packs", "error");
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const counts: Partial<Record<ViewId, number>> = { library: packs, creator: showcases };

  return (
    <div className="app">
      <div className="app-bg" />
      {settings.backgroundFx && settings.effects && !settings.reduceMotion && <FxCanvas snow={themeColors(settings).snow} />}
      <nav className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img src="/icon.png" alt="" />
          <div>
            <b>OnxyMc</b>
            <span>Texture Pack Showcase</span>
          </div>
        </div>
        {NAV.map((n) => (
          <div key={n.id}>
            {n.group && <div className="nav-group">{n.group}</div>}
            <div className={`nav-item ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setView(n.id)} data-nav={n.id}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {counts[n.id] ? <span className="count">{counts[n.id]}</span> : null}
            </div>
          </div>
        ))}
        <div className="sidebar-foot">
          {importing && (
            <div className="col" style={{ gap: 5 }}>
              <span className="tiny">
                Importing {importing.done + 1}/{importing.total}: {importing.current}
              </span>
              <div className="progress">
                <div style={{ width: `${(importing.done / Math.max(1, importing.total)) * 100}%` }} />
              </div>
            </div>
          )}
          <span>
            Minecraft Java {TARGET_VERSION} · v{APP_VERSION}
          </span>
        </div>
      </nav>
      <main className="main">
        <Suspense fallback={<div className="empty">Loading…</div>}>
          {view === "dashboard" && <Dashboard />}
          {view === "library" && <Library />}
          {view === "creator" && <Creator />}
          {view === "animations" && <Animations />}
          {view === "models" && <Models3D />}
          {view === "skybox" && <Skybox />}
          {view === "install" && <Install />}
          {view === "community" && <Community />}
          {view === "appearance" && <Appearance />}
          {view === "settings" && <SettingsView />}
        </Suspense>
      </main>
      {dragOver && <div className="drop-overlay">Drop resource packs to import</div>}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            <Icon name={t.kind === "error" ? "alert" : t.kind === "success" ? "check" : "info"} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <ConfirmHost />
    </div>
  );
}

export function TopBar({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="spacer" />
      {children}
    </header>
  );
}
