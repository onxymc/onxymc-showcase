// Mouse/pen/touch based list reordering. HTML5 drag-and-drop can't be used inside the
// desktop app on Windows, because the native file-drop handler (used for importing packs)
// takes over all drag events in the window.
import { useRef, useState } from "react";

export type DropTarget = { id: string; after: boolean } | null;

export function usePointerReorder(onMove: (from: string, to: string, after: boolean) => void, enabled = true) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget>(null);
  const cb = useRef(onMove);
  cb.current = onMove;

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    let target: DropTarget = null;
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientY - sy) + Math.abs(ev.clientX - sx) < 5) return;
        active = true;
        setDragging(id);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-reorder-id]");
      if (el && el.dataset.reorderId) {
        const r = el.getBoundingClientRect();
        target = { id: el.dataset.reorderId, after: ev.clientY > r.top + r.height / 2 };
      } else target = null;
      setOver(target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (active) {
        // swallow the click that follows a drag so the item isn't also "selected/opened"
        const stop = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
        if (target && target.id !== id) cb.current(id, target.id, target.after);
      }
      setDragging(null);
      setOver(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Props to spread on each reorderable element. */
  const itemProps = (id: string) => ({
    "data-reorder-id": id,
    onPointerDown: onPointerDown(id),
    className: [dragging === id ? "dragging" : "", over?.id === id && dragging !== id ? (over.after ? "drop-after" : "drop-before") : ""].join(" "),
  });
  return { itemProps, dragging };
}

export function moveInList<T extends { id: string }>(list: T[], from: string, to: string, after: boolean): T[] {
  const a = [...list];
  const i = a.findIndex((x) => x.id === from);
  if (i < 0) return list;
  const [it] = a.splice(i, 1);
  const j = a.findIndex((x) => x.id === to);
  if (j < 0) return list;
  a.splice(j + (after ? 1 : 0), 0, it);
  return a;
}

export function moveBy<T extends { id: string }>(list: T[], id: string, delta: number): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const a = [...list];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}
