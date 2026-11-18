import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Btn(p: { children?: ReactNode; onClick?: (e: React.MouseEvent) => void; kind?: "primary" | "ghost" | "danger"; sm?: boolean; icon?: string; title?: string; disabled?: boolean; on?: boolean; iconOnly?: boolean; type?: "button" | "submit" }) {
  const cls = ["btn", p.kind ?? "", p.sm ? "sm" : "", p.iconOnly ? "icon" : "", p.on ? "on" : ""].join(" ");
  return (
    <button type={p.type ?? "button"} className={cls} onClick={p.onClick} title={p.title} aria-label={p.title} disabled={p.disabled}>
      {p.icon && <Icon name={p.icon} size={p.sm ? 15 : 17} />}
      {p.children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

export function TextIn(p: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; onCommit?: () => void; maxLength?: number }) {
  return p.multiline ? (
    <textarea className="input" value={p.value} placeholder={p.placeholder} maxLength={p.maxLength ?? 2000} onChange={(e) => p.onChange(e.target.value)} onBlur={p.onCommit} />
  ) : (
    <input className="input" value={p.value} placeholder={p.placeholder} maxLength={p.maxLength ?? 300} onChange={(e) => p.onChange(e.target.value)} onBlur={p.onCommit} onKeyDown={(e) => e.key === "Enter" && p.onCommit?.()} />
  );
}

export function Select<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className="select" value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Slider(p: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: () => void; fmt?: (v: number) => string }) {
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100;
  return (
    <div className="slider">
      <label>{p.label}</label>
      <output>{p.fmt ? p.fmt(p.value) : p.value}</output>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        style={{ ["--p" as any]: `${pct}%` }}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onPointerUp={p.onCommit}
        onKeyUp={p.onCommit}
        aria-label={p.label}
      />
    </div>
  );
}

export function Toggle(p: { label: ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`toggle ${p.value ? "on" : ""}`} role="switch" aria-checked={p.value} tabIndex={0} onClick={() => p.onChange(!p.value)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && p.onChange(!p.value)}>
      <span className="sw" />
      <span>{p.label}</span>
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
export function ColorIn(p: { value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
  const [txt, setTxt] = useState(p.value);
  useEffect(() => setTxt(p.value), [p.value]);
  const isHex = HEX.test(p.value);
  return (
    <div className="color-in">
      <input type="color" value={isHex ? p.value : "#000000"} onChange={(e) => p.onChange(e.target.value)} aria-label="Pick colour" />
      <input
        className="input"
        value={txt}
        onChange={(e) => {
          const v = e.target.value.trim();
          setTxt(v);
          const n = v.startsWith("#") ? v : `#${v}`;
          if (HEX.test(n)) p.onChange(n.toLowerCase());
          else if (p.allowTransparent && v === "transparent") p.onChange(v);
        }}
      />
    </div>
  );
}

export function Modal(p: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [p.onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={`modal panel ${p.wide ? "wide" : ""}`} role="dialog" aria-label={p.title}>
        <header>
          <h2>{p.title}</h2>
          <Btn kind="ghost" iconOnly icon="x" title="Close" onClick={p.onClose} />
        </header>
        <div className="mbody">{p.children}</div>
        {p.footer && <footer>{p.footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>(p: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon?: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {p.items.map((i) => (
        <button key={i.value} role="tab" aria-selected={p.value === i.value} className={p.value === i.value ? "on" : ""} onClick={() => p.onChange(i.value)}>
          {i.icon && <Icon name={i.icon} size={15} />}
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Promise-based confirm dialog. */
type ConfirmReq = { title: string; body: ReactNode; ok: string; danger?: boolean; extra?: { label: string; value: string }[]; resolve: (v: string | null) => void };
let pushConfirm: ((r: ConfirmReq) => void) | null = null;
export function confirmDialog(title: string, body: ReactNode, ok = "Confirm", opts: { danger?: boolean; extra?: { label: string; value: string }[] } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(window.confirm(title) ? "ok" : null);
    pushConfirm({ title, body, ok, resolve, ...opts });
  });
}
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  pushConfirm = setReq;
  if (!req) return null;
  const done = (v: string | null) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(null)}
      footer={
        <>
          <Btn onClick={() => done(null)}>Cancel</Btn>
          {req.extra?.map((x) => (
            <Btn key={x.value} onClick={() => done(x.value)}>
              {x.label}
            </Btn>
          ))}
          <Btn kind={req.danger ? "danger" : "primary"} onClick={() => done("ok")}>
            {req.ok}
          </Btn>
        </>
      }
    >
      <div className="muted">{req.body}</div>
    </Modal>
  );
}

export function useOnScreen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}
