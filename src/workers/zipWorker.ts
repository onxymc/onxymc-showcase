/// <reference lib="webworker" />
// Keeps opened zip archives off the UI thread. Holds at most a few archives (LRU).
import { indexZip, readZipEntries } from "../core/safeZip";

const MAX_OPEN = 4;
const MAX_BYTES = 600 * 1024 * 1024;
const open = new Map<string, Uint8Array>();

function touch(id: string, data: Uint8Array) {
  open.delete(id);
  open.set(id, data);
  let total = 0;
  for (const d of open.values()) total += d.byteLength;
  while (open.size > MAX_OPEN || (total > MAX_BYTES && open.size > 1)) {
    const [k, v] = open.entries().next().value!;
    open.delete(k);
    total -= v.byteLength;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { rid, type, id } = e.data;
  try {
    if (type === "open") {
      const data: Uint8Array = e.data.bytes;
      const idx = indexZip(data);
      touch(id, data);
      (self as any).postMessage({ rid, ok: true, files: [...idx.entries.keys()], rejected: idx.rejected });
    } else if (type === "has") {
      (self as any).postMessage({ rid, ok: true, has: open.has(id) });
    } else if (type === "read") {
      const data = open.get(id);
      if (!data) throw new Error("NOT_OPEN");
      touch(id, data);
      const m = readZipEntries(data, e.data.paths);
      const entries = [...m.entries()];
      (self as any).postMessage({ rid, ok: true, entries }, entries.map(([, b]) => b.buffer));
    } else if (type === "close") {
      open.delete(id);
      (self as any).postMessage({ rid, ok: true });
    }
  } catch (err: any) {
    (self as any).postMessage({ rid, ok: false, error: String(err?.message ?? err) });
  }
};
