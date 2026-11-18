//! OnxyMc Texture Pack Showcase — native backend.
//!
//! Responsibilities: safe local storage (atomic writes + backups), reading pack
//! sources (zip bytes / folder trees) without ever executing or extracting them,
//! writing exports, and installing packs into Minecraft's resourcepacks folder
//! without touching unrelated files.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{ipc::Response, AppHandle, Emitter, Manager};

const MAX_SOURCE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB zip
const MAX_FOLDER_FILES: usize = 80_000;
const MAX_FOLDER_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_STORE_BYTES: usize = 256 * 1024 * 1024;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------- storage

fn store_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?.join("store");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

fn valid_store_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Write via temp file + fsync + rename, so a crash never leaves a half-written file.
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| std::io::Error::other("no parent dir"))?;
    fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
        std::process::id()
    ));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

#[tauri::command]
fn store_read(app: AppHandle, name: String) -> CmdResult<Option<String>> {
    if !valid_store_name(&name) {
        return Err("invalid store name".into());
    }
    let dir = store_dir(&app)?;
    // Primary file, then the last good backup if the primary is missing or unreadable.
    for candidate in [dir.join(format!("{name}.json")), dir.join(format!("{name}.json.bak"))] {
        if let Ok(text) = fs::read_to_string(&candidate) {
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                return Ok(Some(text));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
fn store_write(app: AppHandle, name: String, contents: String) -> CmdResult<()> {
    if !valid_store_name(&name) {
        return Err("invalid store name".into());
    }
    if contents.len() > MAX_STORE_BYTES {
        return Err("store too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| format!("refusing to store invalid JSON: {e}"))?;
    let dir = store_dir(&app)?;
    let path = dir.join(format!("{name}.json"));
    if path.exists() {
        let _ = fs::copy(&path, dir.join(format!("{name}.json.bak")));
    }
    atomic_write(&path, contents.as_bytes()).map_err(err)
}

#[tauri::command]
fn app_data_path(app: AppHandle) -> CmdResult<String> {
    Ok(app.path().app_data_dir().map_err(err)?.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------- reading sources

#[derive(Serialize)]
struct Stat {
    size: u64,
    modified: u64,
    is_dir: bool,
    exists: bool,
}

fn mtime(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn stat_path(path: String) -> Stat {
    match fs::metadata(&path) {
        Ok(m) => Stat { size: m.len(), modified: mtime(&m), is_dir: m.is_dir(), exists: true },
        Err(_) => Stat { size: 0, modified: 0, is_dir: false, exists: false },
    }
}

#[tauri::command]
async fn read_file(path: String) -> CmdResult<Response> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(err)?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err("file is larger than 1 GiB".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(p)).await.map_err(err)?.map_err(err)?;
    Ok(Response::new(bytes))
}

/// Recursively lists a pack folder. Symlinks are never followed.
#[tauri::command]
async fn list_folder(path: String) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err("not a folder".to_string());
        }
        let mut out = Vec::new();
        let mut stack = vec![(root.clone(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if depth > 32 {
                continue;
            }
            let rd = match fs::read_dir(&dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for entry in rd.flatten() {
                let ft = match entry.file_type() {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                if ft.is_symlink() {
                    continue;
                }
                let p = entry.path();
                if ft.is_dir() {
                    stack.push((p, depth + 1));
                } else if ft.is_file() {
                    if let Ok(rel) = p.strip_prefix(&root) {
                        out.push(rel.to_string_lossy().replace('\\', "/"));
                        if out.len() > MAX_FOLDER_FILES {
                            return Err(format!("folder has more than {MAX_FOLDER_FILES} files"));
                        }
                    }
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

/// Joins a relative, untrusted path onto `root`, refusing anything that escapes it.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    let mut out = root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// Reads many files from a pack folder in one call.
/// Framing: for each requested path, u32 LE length (0xFFFFFFFF = missing) then bytes.
#[tauri::command]
async fn read_folder_files(root: String, paths: Vec<String>) -> CmdResult<Response> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let mut buf: Vec<u8> = Vec::new();
        for rel in paths {
            let data = safe_join(&root, &rel).and_then(|p| {
                let meta = fs::symlink_metadata(&p).ok()?;
                if !meta.is_file() || meta.len() > MAX_FOLDER_FILE_BYTES {
                    return None;
                }
                let mut v = Vec::with_capacity(meta.len() as usize);
                fs::File::open(&p).ok()?.read_to_end(&mut v).ok()?;
                Some(v)
            });
            match data {
                Some(v) => {
                    buf.extend_from_slice(&(v.len() as u32).to_le_bytes());
                    buf.extend_from_slice(&v);
                }
                None => buf.extend_from_slice(&u32::MAX.to_le_bytes()),
            }
        }
        buf
    })
    .await
    .map_err(err)?;
    Ok(Response::new(out))
}

// ---------------------------------------------------------------- writing exports

#[tauri::command]
async fn write_file(request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode(s))
        .ok_or("missing x-path header")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw body".into());
    };
    let p = PathBuf::from(path);
    if p.file_name().is_none() {
        return Err("invalid path".into());
    }
    atomic_write(&p, bytes).map_err(err)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------- Minecraft install

#[tauri::command]
fn detect_minecraft_dir() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(appdata).join(".minecraft"));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".minecraft"));
        candidates.push(PathBuf::from(&home).join("Library/Application Support/minecraft"));
    }
    candidates.into_iter().find(|p| p.is_dir()).map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct InstalledEntry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[tauri::command]
fn list_resourcepacks(dir: String) -> CmdResult<Vec<InstalledEntry>> {
    let d = PathBuf::from(dir);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut v = Vec::new();
    for e in fs::read_dir(&d).map_err(err)?.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        let is_zip = name.to_ascii_lowercase().ends_with(".zip");
        if meta.is_dir() || is_zip {
            v.push(InstalledEntry { name, is_dir: meta.is_dir(), size: meta.len(), modified: mtime(&meta) });
        }
    }
    v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(v)
}

fn valid_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'])
        && name != "."
        && name != ".."
        && !name.ends_with(' ')
        && !name.ends_with('.')
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String,
    copied: u64,
    total: u64,
}

#[derive(Serialize)]
struct InstallResult {
    installed_path: String,
    backup_path: Option<String>,
    verified: bool,
    bytes: u64,
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = fs::read_dir(p) {
        for e in rd.flatten() {
            if let Ok(ft) = e.file_type() {
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    total += dir_size(&e.path());
                } else if let Ok(m) = e.metadata() {
                    total += m.len();
                }
            }
        }
    }
    total
}

fn copy_with_progress(src: &Path, dst: &Path, copied: &mut u64, total: u64, emit: &dyn Fn(u64, u64)) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for e in fs::read_dir(src)?.flatten() {
            copy_with_progress(&e.path(), &dst.join(e.file_name()), copied, total, emit)?;
        }
        return Ok(());
    }
    let mut r = fs::File::open(src)?;
    let mut w = fs::File::create(dst)?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n])?;
        *copied += n as u64;
        emit(*copied, total);
    }
    w.sync_all()
}

/// mode: "fail" (default; refuse if the name exists), "overwrite", or "backup".
#[tauri::command]
async fn install_pack<R: tauri::Runtime>(app: AppHandle<R>, id: String, src: String, dest_dir: String, name: String, mode: String) -> CmdResult<InstallResult> {
    if !valid_entry_name(&name) {
        return Err("invalid pack file name".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let src_p = PathBuf::from(&src);
        let dest_root = PathBuf::from(&dest_dir);
        fs::create_dir_all(&dest_root).map_err(err)?;
        let dest_root = dest_root.canonicalize().map_err(err)?;
        let target = dest_root.join(&name);
        let src_meta = fs::metadata(&src_p).map_err(|e| format!("source not found: {e}"))?;
        // Never install a pack onto itself.
        if let (Ok(a), Ok(b)) = (src_p.canonicalize(), target.canonicalize()) {
            if a == b {
                return Err("the pack is already at this location".into());
            }
        }
        let mut backup_path = None;
        if target.exists() {
            match mode.as_str() {
                "overwrite" => {
                    let tm = fs::symlink_metadata(&target).map_err(err)?;
                    if tm.is_dir() { fs::remove_dir_all(&target).map_err(err)?; } else { fs::remove_file(&target).map_err(err)?; }
                }
                "backup" => {
                    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                    let bak = dest_root.join(format!("{name}.backup-{stamp}"));
                    fs::rename(&target, &bak).map_err(err)?;
                    backup_path = Some(bak.to_string_lossy().into_owned());
                }
                _ => return Err(format!("EXISTS:{name}")),
            }
        }
        let total = if src_meta.is_dir() { dir_size(&src_p) } else { src_meta.len() };
        let mut copied = 0u64;
        let app2 = app.clone();
        let id2 = id.clone();
        let last = std::cell::Cell::new(0u64);
        let emit = move |c: u64, t: u64| {
            // throttle to ~every 2 MiB
            if c - last.get() >= 2 * 1024 * 1024 || c == t {
                last.set(c);
                let _ = app2.emit("install-progress", Progress { id: id2.clone(), copied: c, total: t });
            }
        };
        // Copy into a temp name first, then rename: a failed copy never leaves a broken pack.
        let tmp = dest_root.join(format!(".{name}.installing"));
        if tmp.exists() {
            let _ = if tmp.is_dir() { fs::remove_dir_all(&tmp) } else { fs::remove_file(&tmp) };
        }
        if let Err(e) = copy_with_progress(&src_p, &tmp, &mut copied, total, &emit) {
            let _ = if tmp.is_dir() { fs::remove_dir_all(&tmp) } else { fs::remove_file(&tmp) };
            return Err(format!("copy failed: {e}"));
        }
        fs::rename(&tmp, &target).map_err(err)?;
        let _ = app.emit("install-progress", Progress { id, copied: total, total });
        // Verify: size matches and pack.mcmeta is present where Minecraft expects it.
        let installed_size = if target.is_dir() { dir_size(&target) } else { fs::metadata(&target).map(|m| m.len()).unwrap_or(0) };
        let verified = installed_size == total && (target.is_file() || target.join("pack.mcmeta").is_file());
        Ok(InstallResult { installed_path: target.to_string_lossy().into_owned(), backup_path, verified, bytes: installed_size })
    })
    .await
    .map_err(err)?
}

/// Removes one installed pack entry. The entry must be a direct child of `dest_dir`.
#[tauri::command]
fn remove_installed(dest_dir: String, name: String) -> CmdResult<()> {
    if !valid_entry_name(&name) {
        return Err("invalid name".into());
    }
    let root = PathBuf::from(&dest_dir).canonicalize().map_err(err)?;
    let target = root.join(&name);
    let meta = fs::symlink_metadata(&target).map_err(err)?;
    if meta.file_type().is_symlink() {
        fs::remove_file(&target).map_err(err)?;
        return Ok(());
    }
    let canon = target.canonicalize().map_err(err)?;
    if canon.parent() != Some(root.as_path()) {
        return Err("refusing to remove a path outside the resourcepacks folder".into());
    }
    if meta.is_dir() {
        if !canon.join("pack.mcmeta").is_file() && !canon.join("assets").is_dir() {
            return Err("refusing to remove a folder that does not look like a resource pack".into());
        }
        fs::remove_dir_all(&canon).map_err(err)
    } else {
        fs::remove_file(&canon).map_err(err)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            store_read,
            store_write,
            app_data_path,
            stat_path,
            read_file,
            list_folder,
            read_folder_files,
            write_file,
            detect_minecraft_dir,
            list_resourcepacks,
            install_pack,
            remove_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running OnxyMc Texture Pack Showcase");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_blocks_traversal() {
        let root = Path::new("/packs/a");
        assert!(safe_join(root, "../b").is_none());
        assert!(safe_join(root, "/etc/passwd").is_none());
        assert_eq!(safe_join(root, "assets/x.png").unwrap(), Path::new("/packs/a/assets/x.png"));
    }

    #[test]
    fn entry_names() {
        assert!(valid_entry_name("My Pack.zip"));
        assert!(!valid_entry_name("../x"));
        assert!(!valid_entry_name("a\\b"));
        assert!(!valid_entry_name(".."));
    }

    #[test]
    fn atomic_write_roundtrip() {
        let d = std::env::temp_dir().join(format!("onxy-test-{}", std::process::id()));
        let p = d.join("f.json");
        atomic_write(&p, b"{\"a\":1}").unwrap();
        atomic_write(&p, b"{\"a\":2}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":2}");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("C%3A%5CUsers%5Cme%5Cshow%20case.png"), "C:\\Users\\me\\show case.png");
    }
}

#[cfg(test)]
mod ipc_tests {
    use super::*;
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .invoke_handler(tauri::generate_handler![install_pack, remove_installed, list_resourcepacks])
            .build(mock_context(noop_assets()))
            .unwrap()
    }

    fn call(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: serde_json::Value) -> Result<serde_json::Value, serde_json::Value> {
        get_ipc_response(
            w,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|r| r.deserialize::<serde_json::Value>().unwrap())
    }

    #[test]
    fn install_conflict_backup_remove() {
        let app = app();
        let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let root = std::env::temp_dir().join(format!("onxy-ipc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let packs = root.join("resourcepacks");
        fs::create_dir_all(&packs).unwrap();
        fs::write(packs.join("Unrelated.zip"), b"keep me").unwrap();
        fs::write(packs.join("options.txt"), b"keep me too").unwrap();
        let src = root.join("My Pack.zip");
        fs::write(&src, vec![7u8; 3 * 1024 * 1024]).unwrap();
        let args = |mode: &str| serde_json::json!({ "id": "p1", "src": src.to_string_lossy(), "destDir": packs.to_string_lossy(), "name": "My Pack.zip", "mode": mode });

        let r = call(&w, "install_pack", args("fail")).unwrap();
        assert_eq!(r["verified"], true);
        assert_eq!(fs::read(packs.join("My Pack.zip")).unwrap().len(), 3 * 1024 * 1024);
        // second install without consent must refuse and change nothing
        let e = call(&w, "install_pack", args("fail")).unwrap_err();
        assert!(e.as_str().unwrap().starts_with("EXISTS:"));
        // backup mode keeps the old copy
        let r = call(&w, "install_pack", args("backup")).unwrap();
        assert!(r["backup_path"].as_str().unwrap().contains("My Pack.zip.backup-"));
        // traversal names are rejected
        let mut bad = args("overwrite");
        bad["name"] = serde_json::json!("../evil.zip");
        assert!(call(&w, "install_pack", bad).is_err());
        assert!(call(&w, "remove_installed", serde_json::json!({ "destDir": packs.to_string_lossy(), "name": "../My Pack.zip" })).is_err());
        // a folder that isn't a resource pack is never removed
        fs::create_dir_all(packs.join("NotAPack")).unwrap();
        assert!(call(&w, "remove_installed", serde_json::json!({ "destDir": packs.to_string_lossy(), "name": "NotAPack" })).is_err());
        call(&w, "remove_installed", serde_json::json!({ "destDir": packs.to_string_lossy(), "name": "My Pack.zip" })).unwrap();
        assert!(!packs.join("My Pack.zip").exists());
        // unrelated files untouched, original untouched
        assert_eq!(fs::read(packs.join("Unrelated.zip")).unwrap(), b"keep me");
        assert_eq!(fs::read(packs.join("options.txt")).unwrap(), b"keep me too");
        assert!(src.exists());
        let listed = call(&w, "list_resourcepacks", serde_json::json!({ "dir": packs.to_string_lossy() })).unwrap();
        assert!(listed.as_array().unwrap().iter().any(|e| e["name"] == "Unrelated.zip"));
        fs::remove_dir_all(root).unwrap();
    }
}
