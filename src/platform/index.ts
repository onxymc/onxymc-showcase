// Platform abstraction: the Tauri desktop backend, with a browser fallback
// (IndexedDB + file inputs) used for development and automated UI tests.

export interface PickedSource {
  kind: "zip" | "folder" | "blob";
  name: string;
  path: string; // absolute path (desktop) or blob key (browser)
  size: number;
  modified: number;
  /** Browser-only: the data, stored on import */
  file?: File;
  /** Browser-only folder import: relative path → File */
  folderFiles?: Map<string, File>;
}

export interface InstallResult {
  installed_path: string;
  backup_path: string | null;
  verified: boolean;
  bytes: number;
}
export interface InstalledEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let tauriCore: typeof import("@tauri-apps/api/core") | null = null;
async function core() {
  return (tauriCore ??= await import("@tauri-apps/api/core"));
}
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (await core()).invoke<T>(cmd, args);
}

// ---------------------------------------------------------------- browser IndexedDB helpers
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("onxymc", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("blobs");
      r.result.createObjectStore("store");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  });
}

// ---------------------------------------------------------------- storage
export async function storeRead(name: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>("store_read", { name });
  try {
    return (await idbOp<string | undefined>("store", "readonly", (s) => s.get(name))) ?? null;
  } catch {
    return localStorage.getItem(`onxymc:${name}`);
  }
}
export async function storeWrite(name: string, contents: string): Promise<void> {
  if (isTauri) return invoke("store_write", { name, contents });
  await idbOp("store", "readwrite", (s) => s.put(contents, name));
}

// ---------------------------------------------------------------- sources
export async function statPath(path: string): Promise<{ size: number; modified: number; is_dir: boolean; exists: boolean }> {
  if (isTauri) return invoke("stat_path", { path });
  const b = await idbOp<Blob | undefined>("blobs", "readonly", (s) => s.get(path));
  return { size: b?.size ?? 0, modified: 0, is_dir: false, exists: !!b };
}

export async function readSourceBytes(kind: string, path: string): Promise<Uint8Array> {
  if (isTauri) {
    const buf = await invoke<ArrayBuffer>("read_file", { path });
    return new Uint8Array(buf);
  }
  const b = await idbOp<Blob | undefined>("blobs", "readonly", (s) => s.get(path));
  if (!b) throw new Error("Pack data is missing from browser storage");
  if (kind === "folder") throw new Error("folder blobs are read via readFolderFiles");
  return new Uint8Array(await b.arrayBuffer());
}

export async function listFolder(path: string): Promise<string[]> {
  if (isTauri) return invoke<string[]>("list_folder", { path });
  const m = await idbOp<Record<string, Blob> | undefined>("blobs", "readonly", (s) => s.get(path));
  return m ? Object.keys(m) : [];
}

export async function readFolderFiles(root: string, paths: string[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (paths.length === 0) return out;
  if (isTauri) {
    for (let i = 0; i < paths.length; i += 400) {
      const chunk = paths.slice(i, i + 400);
      const buf = new Uint8Array(await invoke<ArrayBuffer>("read_folder_files", { root, paths: chunk }));
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      let o = 0;
      for (const p of chunk) {
        const len = dv.getUint32(o, true);
        o += 4;
        if (len === 0xffffffff) continue;
        out.set(p, buf.slice(o, o + len));
        o += len;
      }
    }
    return out;
  }
  const m = await idbOp<Record<string, Blob> | undefined>("blobs", "readonly", (s) => s.get(root));
  if (m) for (const p of paths) if (m[p]) out.set(p, new Uint8Array(await m[p].arrayBuffer()));
  return out;
}

/** Browser mode: persist the picked data so the library survives reloads. */
export async function persistBrowserSource(key: string, src: PickedSource) {
  if (isTauri) return;
  if (src.file) await idbOp("blobs", "readwrite", (s) => s.put(src.file!, key));
  else if (src.folderFiles) {
    const rec: Record<string, Blob> = {};
    for (const [k, f] of src.folderFiles) rec[k] = f;
    await idbOp("blobs", "readwrite", (s) => s.put(rec, key));
  }
}
export async function deleteBrowserSource(key: string) {
  if (!isTauri) await idbOp("blobs", "readwrite", (s) => s.delete(key));
}

// ---------------------------------------------------------------- pickers
function pickViaInput(opts: { dir?: boolean; accept?: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file";
    if (opts.accept) i.accept = opts.accept;
    i.multiple = !!opts.multiple;
    if (opts.dir) (i as any).webkitdirectory = true;
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}

export async function pickPackZips(): Promise<PickedSource[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: true, filters: [{ name: "Resource packs", extensions: ["zip"] }] });
    const paths = Array.isArray(sel) ? sel : sel ? [sel] : [];
    return Promise.all(paths.map(pathToSource));
  }
  const files = await pickViaInput({ accept: ".zip", multiple: true });
  return files.map(fileToSource);
}

export async function pickPackFolder(): Promise<PickedSource | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ directory: true });
    return typeof sel === "string" ? pathToSource(sel) : null;
  }
  const files = await pickViaInput({ dir: true });
  return filesToFolderSource(files);
}

export async function pickDirectory(title?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const sel = await open({ directory: true, title });
  return typeof sel === "string" ? sel : null;
}

export async function pathToSource(path: string): Promise<PickedSource> {
  const st = await statPath(path);
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return { kind: st.is_dir ? "folder" : "zip", name, path, size: st.size, modified: st.modified };
}
export function fileToSource(f: File): PickedSource {
  return { kind: "blob", name: f.name, path: "", size: f.size, modified: f.lastModified, file: f };
}
export function filesToFolderSource(files: File[]): PickedSource | null {
  if (!files.length) return null;
  const map = new Map<string, File>();
  let size = 0;
  const first = (files[0] as any).webkitRelativePath?.split("/")[0] ?? "Folder";
  for (const f of files) {
    const rel: string = (f as any).webkitRelativePath || f.name;
    map.set(rel.split("/").slice(1).join("/") || rel, f);
    size += f.size;
  }
  return { kind: "folder", name: first, path: "", size, modified: Date.now(), folderFiles: map };
}

// ---------------------------------------------------------------- saving / opening
export async function saveBytes(defaultName: string, bytes: Uint8Array, filters: { name: string; extensions: string[] }[], defaultDir?: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const sep = defaultDir && defaultDir.includes("\\") ? "\\" : "/";
    const path = await save({ defaultPath: defaultDir ? `${defaultDir}${sep}${defaultName}` : defaultName, filters });
    if (!path) return null;
    // The native save dialog already asked before replacing an existing file.
    await (await core()).invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return defaultName;
}

export async function openExternal(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error("Only https:// links can be opened");
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function openFolder(path: string) {
  if (!isTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  return openPath(path);
}
export async function revealInFolder(path: string) {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  return revealItemInDir(path);
}

// ---------------------------------------------------------------- install
export async function detectMinecraftDir(): Promise<string | null> {
  return isTauri ? invoke<string | null>("detect_minecraft_dir") : null;
}
export async function listResourcepacks(dir: string): Promise<InstalledEntry[]> {
  return isTauri ? invoke("list_resourcepacks", { dir }) : [];
}
export async function installPack(id: string, src: string, destDir: string, name: string, mode: "fail" | "overwrite" | "backup"): Promise<InstallResult> {
  if (!isTauri) throw new Error("Installing requires the desktop app");
  return invoke("install_pack", { id, src, destDir, name, mode });
}
export async function removeInstalled(destDir: string, name: string) {
  if (!isTauri) throw new Error("Requires the desktop app");
  return invoke("remove_installed", { destDir, name });
}
export async function onInstallProgress(cb: (p: { id: string; copied: number; total: number }) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ id: string; copied: number; total: number }>("install-progress", (e) => cb(e.payload));
}
export async function onFileDrop(cb: (paths: string[]) => void, hover: (over: boolean) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload as any;
    if (p.type === "over" || p.type === "enter") hover(true);
    else if (p.type === "leave") hover(false);
    else if (p.type === "drop") {
      hover(false);
      cb(p.paths ?? []);
    }
  });
}
