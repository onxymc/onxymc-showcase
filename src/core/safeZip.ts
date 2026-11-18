// Untrusted-ZIP handling. Imported packs are never extracted to disk; entries are
// inflated into memory on demand, with limits that defend against zip bombs,
// path traversal and malformed archives.
import { unzipSync, type UnzipFileInfo } from "fflate";

export const ZIP_LIMITS = {
  maxEntries: 80_000,
  maxEntryBytes: 64 * 1024 * 1024, // a single decompressed file
  maxTotalReadBytes: 768 * 1024 * 1024, // per read call
  maxRatio: 1000, // suspicious compression ratio for large files
  ratioCheckAbove: 8 * 1024 * 1024,
};

/** Normalise an archive path; returns null for anything unsafe. */
export function sanitizeEntryPath(raw: string): string | null {
  if (!raw || raw.length > 1024) return null;
  if (raw.includes("\0")) return null;
  let p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null; // absolute
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null; // traversal is rejected, never resolved
    parts.push(seg);
  }
  p = parts.join("/");
  return p || null;
}

export interface ZipEntryInfo {
  path: string;
  size: number; // compressed
  originalSize: number;
}

export interface ZipIndex {
  entries: Map<string, ZipEntryInfo>; // keyed by sanitized lowercase-preserving path
  rejected: string[];
}

function entryAllowed(f: UnzipFileInfo): boolean {
  if (f.originalSize > ZIP_LIMITS.maxEntryBytes) return false;
  if (f.originalSize > ZIP_LIMITS.ratioCheckAbove && f.size > 0 && f.originalSize / f.size > ZIP_LIMITS.maxRatio) return false;
  return true;
}

/** Reads only the central directory — nothing is inflated. */
export function indexZip(data: Uint8Array): ZipIndex {
  const entries = new Map<string, ZipEntryInfo>();
  const rejected: string[] = [];
  let count = 0;
  unzipSync(data, {
    filter(f) {
      count++;
      if (count > ZIP_LIMITS.maxEntries) throw new Error(`Archive has more than ${ZIP_LIMITS.maxEntries} entries`);
      if (f.name.endsWith("/")) return false; // directory
      const safe = sanitizeEntryPath(f.name);
      if (!safe) {
        rejected.push(f.name);
        return false;
      }
      if (!entryAllowed(f)) {
        rejected.push(`${safe} (too large)`);
        return false;
      }
      entries.set(safe, { path: safe, size: f.size, originalSize: f.originalSize });
      return false;
    },
  });
  return { entries, rejected };
}

/** Inflates the requested (sanitized) paths. Unknown paths are ignored. */
export function readZipEntries(data: Uint8Array, wanted: Iterable<string>): Map<string, Uint8Array> {
  const want = new Set(wanted);
  const out = new Map<string, Uint8Array>();
  if (want.size === 0) return out;
  let budget = ZIP_LIMITS.maxTotalReadBytes;
  const nameMap = new Map<string, string>();
  const files = unzipSync(data, {
    filter(f) {
      const safe = sanitizeEntryPath(f.name);
      if (!safe || !want.has(safe) || !entryAllowed(f)) return false;
      if (f.originalSize > budget) return false;
      budget -= f.originalSize;
      nameMap.set(f.name, safe);
      return true;
    },
  });
  for (const [raw, bytes] of Object.entries(files)) {
    const safe = nameMap.get(raw);
    if (safe) out.set(safe, bytes);
  }
  return out;
}
