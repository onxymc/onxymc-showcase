// Installation flow shared by pack cards and the Install tab.
import { createElement } from "react";
import { useApp } from "../state/store";
import { confirmDialog } from "../ui/controls";
import { detectMinecraftDir, installPack, isTauri, pickDirectory, type InstallResult } from "../platform";
import type { PackRecord } from "./types";

export async function resolveResourcepacksDir(ask = false): Promise<string | null> {
  const st = useApp.getState();
  if (st.settings.resourcepacksDir && !ask) return st.settings.resourcepacksDir;
  if (!ask) {
    const mc = st.settings.minecraftDir ?? (await detectMinecraftDir());
    if (mc) {
      const sep = mc.includes("\\") ? "\\" : "/";
      const dir = `${mc}${sep}resourcepacks`;
      st.setSettings({ minecraftDir: mc, resourcepacksDir: dir });
      return dir;
    }
  }
  const picked = await pickDirectory("Choose a resourcepacks folder");
  if (picked) st.setSettings({ resourcepacksDir: picked });
  return picked;
}

export function installFileName(p: PackRecord) {
  const base = p.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? p.originalName;
  return base.replace(/[\\/:*?"<>|]/g, "_");
}

export async function installWithPrompts(p: PackRecord, destDir?: string): Promise<InstallResult | null> {
  const st = useApp.getState();
  if (!isTauri) {
    st.toast("Installing into Minecraft requires the desktop app.", "error");
    return null;
  }
  if (p.sourcePath.startsWith("blob:")) {
    st.toast("This pack has no file on disk to install.", "error");
    return null;
  }
  const dir = destDir ?? (await resolveResourcepacksDir());
  if (!dir) return null;
  const name = installFileName(p);
  let mode: "fail" | "overwrite" | "backup" = "fail";
  for (;;) {
    try {
      const r = await installPack(p.id, p.sourcePath, dir, name, mode);
      st.updatePack(p.id, { installedAs: name });
      st.toast(r.verified ? `Installed “${name}” ✓` : `Installed “${name}”, but verification failed — check the folder`, r.verified ? "success" : "error");
      return r;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.startsWith("EXISTS:") && mode === "fail") {
        const choice = await confirmDialog(
          "Pack already installed",
          createElement("span", null, `“${name}” already exists in the resourcepacks folder. Nothing has been changed yet.`),
          "Overwrite",
          { danger: true, extra: [{ label: "Back up & replace", value: "backup" }] },
        );
        if (!choice) return null;
        mode = choice === "backup" ? "backup" : "overwrite";
        continue;
      }
      st.toast(`Install failed: ${msg}`, "error");
      return null;
    }
  }
}
