// Undo/redo for the showcase editor. Rapid edits with the same key (e.g. dragging a
// slider) are coalesced into a single history step.
import { useCallback, useRef, useState } from "react";

export function useHistory<T>(initial: T, onChange: (v: T) => void, limit = 120) {
  const [, force] = useState(0);
  const h = useRef({ past: [] as T[], present: initial, future: [] as T[], lastKey: "", lastAt: 0 });
  const reset = useCallback((v: T) => {
    h.current = { past: [], present: v, future: [], lastKey: "", lastAt: 0 };
    force((n) => n + 1);
  }, []);
  const set = useCallback(
    (next: T, key = "") => {
      const s = h.current;
      const now = Date.now();
      const coalesce = key && key === s.lastKey && now - s.lastAt < 800;
      if (!coalesce) {
        s.past.push(s.present);
        if (s.past.length > limit) s.past.shift();
      }
      s.present = next;
      s.future = [];
      s.lastKey = key;
      s.lastAt = now;
      onChange(next);
      force((n) => n + 1);
    },
    [onChange],
  );
  const undo = useCallback(() => {
    const s = h.current;
    const prev = s.past.pop();
    if (prev === undefined) return;
    s.future.unshift(s.present);
    s.present = prev;
    s.lastKey = "";
    onChange(prev);
    force((n) => n + 1);
  }, [onChange]);
  const redo = useCallback(() => {
    const s = h.current;
    const next = s.future.shift();
    if (next === undefined) return;
    s.past.push(s.present);
    s.present = next;
    s.lastKey = "";
    onChange(next);
    force((n) => n + 1);
  }, [onChange]);
  return { value: h.current.present, set, undo, redo, reset, canUndo: h.current.past.length > 0, canRedo: h.current.future.length > 0 };
}
