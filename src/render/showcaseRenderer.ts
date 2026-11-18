// Pure canvas renderer for showcases. The editor preview and every export go
// through the same code at different scales, so exports match the editor and
// textures are always re-drawn at the target resolution (never upscaled bitmaps).
import { sampleTimeline } from "../core/animation";
import { SKY_COLUMN, columnLabel } from "../core/catalog";
import { FONTS, type Showcase, type ShowcaseColumn, type ShowcaseRow } from "../core/showcase";
import type { LoadedTexture } from "../core/packAccess";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CellBox extends Rect {
  row: ShowcaseRow;
  col: ShowcaseColumn;
  sky: boolean;
}
export interface RowBox {
  row: ShowcaseRow;
  label: Rect;
  band: Rect;
}
export interface Layout {
  width: number;
  height: number;
  cells: CellBox[];
  rows: RowBox[];
  headers: { col: ShowcaseColumn; rect: Rect }[];
  titleY: number;
  footerY: number;
}

export interface TexSource {
  tex(rowId: string, colId: string): LoadedTexture | null | undefined;
  sky(rowId: string): CanvasImageSource | null | undefined;
}

const font = (id: keyof typeof FONTS, size: number, weight = 600) => `${weight} ${size}px ${FONTS[id].css}`;

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
/** Width the label column needs so no variant name is cut off. */
export function autoLabelWidth(sc: Showcase): number {
  const s = sc.style;
  measureCtx ??= new OffscreenCanvas(4, 4).getContext("2d");
  if (!measureCtx) return s.labelWidth;
  let w = 0;
  for (const r of sc.rows) {
    if (r.hidden) continue;
    measureCtx.font = font(s.labelFont, s.labelSize, 700);
    let rw = measureCtx.measureText(r.name || "Untitled").width;
    if (r.badge) {
      measureCtx.font = font(s.labelFont, Math.max(8, Math.round(s.labelSize * 0.55)), 700);
      rw += 6 + measureCtx.measureText(r.badge).width;
    }
    if (s.showHex) {
      measureCtx.font = font(s.labelFont, s.hexSize, 500);
      rw = Math.max(rw, measureCtx.measureText("#AAAAAA").width);
    }
    w = Math.max(w, rw);
  }
  const sw = s.showSwatch ? s.swatchSize + Math.round(s.swatchSize * 0.45) : 0;
  return Math.ceil(sw + w + 12 + 16);
}

export function computeLayout(sc: Showcase): Layout {
  sc = sc.style.labelWidthAuto && sc.style.layout === "rows" ? { ...sc, style: { ...sc.style, labelWidth: autoLabelWidth(sc) } } : sc;
  const s = sc.style;
  const P = s.padding;
  const rows = sc.rows.filter((r) => !r.hidden);
  const cols = sc.columns;
  const hasHeader = !!(sc.title || sc.subtitle || sc.cornerText || sc.cornerSubText);
  let y = P;
  const titleY = y;
  if (hasHeader) y += Math.round(s.titleSize * 1.5) + (sc.subtitle ? Math.round(s.hexSize * 1.6) : 0) + Math.round(s.rowGap * 1.2) + 8;
  const cells: CellBox[] = [];
  const rowBoxes: RowBox[] = [];
  const headers: Layout["headers"] = [];
  const colW = (c: ShowcaseColumn) => (c.key === SKY_COLUMN ? Math.round(s.cellSize * s.skyWidthCells) : s.cellSize);
  const rowH = s.cellSize + s.rowHeightExtra;
  let width: number;

  if (s.layout === "grid") {
    const n = Math.max(1, s.gridColumns);
    const items = cols.filter((c) => c.key !== SKY_COLUMN);
    const sky = cols.find((c) => c.key === SKY_COLUMN);
    const gridW = n * s.cellSize + (n - 1) * s.colGap;
    width = P * 2 + gridW;
    for (const r of rows) {
      const labelH = Math.round(Math.max(s.labelSize * 1.4, s.showSwatch ? s.swatchSize : 0) + (s.showHex ? s.hexSize * 1.3 : 0));
      const label = { x: P, y, w: gridW, h: labelH };
      y += labelH + 8;
      const top = y;
      items.forEach((c, i) => {
        const cx = P + (i % n) * (s.cellSize + s.colGap);
        const cy = top + Math.floor(i / n) * (rowH + s.colGap);
        cells.push({ x: cx, y: cy, w: s.cellSize, h: rowH, row: r, col: c, sky: false });
      });
      y = top + Math.ceil(items.length / n) * (rowH + s.colGap) - s.colGap;
      if (sky) {
        y += s.colGap;
        cells.push({ x: P, y, w: gridW, h: Math.round(rowH * 1.4), row: r, col: sky, sky: true });
        y += Math.round(rowH * 1.4);
      }
      rowBoxes.push({ row: r, label, band: { x: P - 6, y: label.y - 6, w: gridW + 12, h: y - label.y + 12 } });
      y += s.rowGap;
    }
    y -= s.rowGap;
  } else {
    const x0 = P + s.labelWidth;
    let x = x0;
    const xs = cols.map((c) => {
      const cx = x;
      x += colW(c) + s.colGap;
      return cx;
    });
    width = Math.max(x - s.colGap + P, P * 2 + s.labelWidth + 40);
    if (s.showColumnHeaders) {
      const hh = Math.round(s.hexSize * 1.8);
      cols.forEach((c, i) => headers.push({ col: c, rect: { x: xs[i], y, w: colW(c), h: hh } }));
      y += hh + 4;
    }
    for (const r of rows) {
      cols.forEach((c, i) => cells.push({ x: xs[i], y, w: colW(c), h: rowH, row: r, col: c, sky: c.key === SKY_COLUMN }));
      rowBoxes.push({ row: r, label: { x: P, y, w: s.labelWidth - 12, h: rowH }, band: { x: P - 8, y: y - s.rowGap / 2 + 1, w: width - 2 * P + 16, h: rowH + s.rowGap - 2 } });
      y += rowH + s.rowGap;
    }
    if (rows.length) y -= s.rowGap;
  }
  const footerY = y + (rows.length ? Math.round(s.rowGap * 1.5) : 0);
  let height = footerY;
  if (s.showVersion || (s.showDescription && s.description)) height += Math.round(s.hexSize * 1.6) * ((s.showVersion ? 1 : 0) + (s.showDescription && s.description ? 1 : 0));
  height += P;
  return { width: Math.ceil(width), height: Math.ceil(Math.max(height, P * 2 + 20)), cells, rows: rowBoxes, headers, titleY, footerY };
}

// ---------------------------------------------------------------- drawing
function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, r: Rect, rad: number) {
  ctx.beginPath();
  if (rad > 0 && (ctx as any).roundRect) (ctx as any).roundRect(r.x, r.y, r.w, r.h, rad);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawTexture(ctx: Ctx, t: LoadedTexture, box: Rect, scale: number, tick: number, itemScale: number) {
  const tl = t.timeline;
  const fw = tl ? tl.frameW : t.width;
  const fh = tl ? tl.frameH : t.height;
  const fmax = Math.max(fw, fh);
  const targetDev = Math.min(box.w, box.h) * itemScale * scale;
  const k = targetDev >= fmax ? Math.floor(targetDev / fmax) : targetDev / fmax;
  const dw = (fw * k) / scale, dh = (fh * k) / scale;
  const dx = Math.round((box.x + (box.w - dw) / 2) * scale) / scale;
  const dy = Math.round((box.y + (box.h - dh) / 2) * scale) / scale;
  ctx.imageSmoothingEnabled = k < 1;
  if (!tl) {
    ctx.drawImage(t.bitmap, 0, 0, fw, fh, dx, dy, dw, dh);
    return;
  }
  const smp = sampleTimeline(tl, tick);
  const fx = (smp.index % tl.cols) * fw, fy = Math.floor(smp.index / tl.cols) * fh;
  ctx.drawImage(t.bitmap, fx, fy, fw, fh, dx, dy, dw, dh);
  if (smp.mix > 0) {
    const nx = (smp.nextIndex % tl.cols) * fw, ny = Math.floor(smp.nextIndex / tl.cols) * fh;
    ctx.globalAlpha = smp.mix;
    ctx.drawImage(t.bitmap, nx, ny, fw, fh, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
  }
}

function glowColor(sc: Showcase, row: ShowcaseRow) {
  return sc.style.glowMode === "row" ? row.color : sc.style.glowColor;
}

export function drawCell(ctx: Ctx, sc: Showcase, cell: CellBox, src: TexSource, scale: number, tick: number, skipAnimated = false) {
  const s = sc.style;
  const r: Rect = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
  if (s.cellBg && s.cellBg !== "transparent") {
    ctx.fillStyle = s.cellBg;
    roundRect(ctx, r, s.cellRadius);
    ctx.fill();
  }
  if (s.glow > 0 && !cell.sky) {
    const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.6);
    const c = glowColor(sc, cell.row);
    g.addColorStop(0, hexA(c, 0.35 * s.glow));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (cell.sky) {
    const img = src.sky(cell.row.id);
    if (img) {
      ctx.save();
      roundRect(ctx, r, s.cellRadius);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (img === null) {
      ctx.fillStyle = "#6f8fd6";
      roundRect(ctx, r, s.cellRadius);
      ctx.fill();
      ctx.fillStyle = "#1d2a4a";
      ctx.font = font("inter", Math.max(9, Math.round(s.hexSize * 0.9)), 500);
      ctx.textBaseline = "top";
      ctx.fillText("vanilla", r.x + 5, r.y + 4);
    }
  } else {
    const t = src.tex(cell.row.id, cell.col.id);
    if (t && !(skipAnimated && t.timeline)) drawTexture(ctx, t, r, scale, Math.floor(tick * s.animSpeed), s.itemScale);
  }
  if (s.showGrid && s.cellBorderWidth > 0) {
    ctx.save();
    if (s.glow > 0) {
      ctx.shadowColor = hexA(glowColor(sc, cell.row), Math.min(1, s.glow));
      ctx.shadowBlur = 14 * s.glow * scale;
    }
    ctx.strokeStyle = s.cellBorderColor;
    ctx.lineWidth = s.cellBorderWidth;
    const h = s.cellBorderWidth / 2;
    roundRect(ctx, { x: r.x + h, y: r.y + h, w: r.w - s.cellBorderWidth, h: r.h - s.cellBorderWidth }, Math.max(0, s.cellRadius - h));
    ctx.stroke();
    ctx.restore();
  }
}

export function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(128,128,128,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fitText(ctx: Ctx, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

export interface DrawOptions {
  scale: number;
  tick: number;
  transparent?: boolean;
  backgroundImage?: CanvasImageSource | null;
  /** extra offset (export letterboxing), in layout units */
  offsetX?: number;
  offsetY?: number;
  canvasW?: number;
  canvasH?: number;
  /** leave animated textures out (the live preview paints them per tick) */
  skipAnimated?: boolean;
}

export function drawShowcase(ctx: Ctx, sc: Showcase, layout: Layout, src: TexSource, o: DrawOptions) {
  const s = sc.style;
  const W = o.canvasW ?? layout.width * o.scale;
  const H = o.canvasH ?? layout.height * o.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!o.transparent) {
    ctx.globalAlpha = s.backgroundOpacity;
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (o.backgroundImage) {
      const bi: any = o.backgroundImage;
      const iw = bi.width, ih = bi.height;
      const k = Math.max(W / iw, H / ih);
      ctx.globalAlpha = s.backgroundImageOpacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bi, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      ctx.globalAlpha = 1;
    }
  }
  ctx.setTransform(o.scale, 0, 0, o.scale, (o.offsetX ?? 0) * o.scale, (o.offsetY ?? 0) * o.scale);
  ctx.textBaseline = "alphabetic";
  const P = s.padding;

  // header
  if (sc.title || sc.subtitle || sc.cornerText || sc.cornerSubText) {
    ctx.fillStyle = s.titleColor;
    ctx.font = font(s.titleFont, s.titleSize, 700);
    ctx.textBaseline = "top";
    ctx.fillText(fitText(ctx, sc.title, layout.width * 0.6), P, layout.titleY);
    if (sc.subtitle) {
      ctx.fillStyle = s.subtitleColor;
      ctx.font = font(s.labelFont, s.hexSize, 500);
      ctx.fillText(sc.subtitle, P, layout.titleY + s.titleSize * 1.35);
    }
    ctx.textAlign = "right";
    if (sc.cornerText) {
      ctx.fillStyle = s.cornerColor;
      ctx.font = font(s.labelFont, Math.round(s.hexSize * 1.05), 700);
      ctx.fillText(fitText(ctx, sc.cornerText, layout.width * 0.45), layout.width - P, layout.titleY);
    }
    if (sc.cornerSubText) {
      ctx.fillStyle = s.subtitleColor;
      ctx.font = font(s.labelFont, s.hexSize, 500);
      ctx.fillText(sc.cornerSubText, layout.width - P, layout.titleY + s.hexSize * 1.5);
    }
    ctx.textAlign = "left";
  }

  // column headers
  ctx.textBaseline = "middle";
  for (const h of layout.headers) {
    ctx.fillStyle = s.headerColor;
    ctx.font = font(s.labelFont, Math.max(8, Math.round(s.hexSize * 0.85)), 500);
    ctx.textAlign = "center";
    ctx.fillText(fitText(ctx, h.col.label || columnLabel(h.col.key), h.rect.w + s.colGap - 2), h.rect.x + h.rect.w / 2, h.rect.y + h.rect.h / 2);
  }
  ctx.textAlign = "left";

  // rows
  for (const rb of layout.rows) {
    const r = rb.row;
    if (s.rowStripe) {
      ctx.fillStyle = s.rowStripeColor;
      roundRect(ctx, rb.band, s.rowRadius);
      ctx.fill();
    }
    const L = rb.label;
    let tx = L.x;
    if (s.showSwatch) {
      const sw = s.swatchSize;
      const sy = s.layout === "grid" ? L.y : L.y + Math.max(0, (L.h - sw) / 2 - (s.showHex ? 0 : 0));
      ctx.fillStyle = r.color;
      ctx.fillRect(tx, sy + (s.layout === "grid" ? 0 : 0), sw, sw);
      ctx.strokeStyle = "#3a3a44";
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 1, sy + 1, sw - 2, sw - 2);
      tx += sw + Math.round(sw * 0.45);
    }
    const nameColor = s.nameColorMode === "row" ? lighten(r.color) : s.nameColor;
    ctx.font = font(s.labelFont, s.labelSize, 700);
    ctx.fillStyle = nameColor;
    const twoLines = s.showHex;
    const block = s.labelSize + (twoLines ? s.hexSize * 1.25 : 0);
    const top = s.layout === "grid" ? L.y : L.y + (L.h - block) / 2;
    ctx.textBaseline = "top";
    const maxName = L.w - (tx - L.x);
    const name = fitText(ctx, r.name || "Untitled", Math.max(20, maxName - (r.badge ? 40 : 0)));
    ctx.fillText(name, tx, top);
    if (r.badge) {
      const nw = ctx.measureText(name).width;
      ctx.font = font(s.labelFont, Math.max(8, Math.round(s.labelSize * 0.55)), 700);
      ctx.fillStyle = s.cornerColor;
      ctx.fillText(r.badge, tx + nw + 6, top + s.labelSize * 0.38);
    }
    if (twoLines) {
      ctx.font = font(s.labelFont, s.hexSize, 500);
      ctx.fillStyle = s.hexColor;
      ctx.fillText(r.color.toUpperCase(), tx, top + s.labelSize * 1.15);
    }
  }

  for (const c of layout.cells) drawCell(ctx, sc, c, src, o.scale, o.tick, o.skipAnimated);

  // footer
  let fy = layout.footerY;
  ctx.textBaseline = "top";
  ctx.font = font(s.labelFont, s.hexSize, 500);
  ctx.fillStyle = s.subtitleColor;
  if (s.showVersion) {
    ctx.fillText(`Minecraft Java ${s.versionText}`, P, fy);
    fy += s.hexSize * 1.6;
  }
  if (s.showDescription && s.description) ctx.fillText(fitText(ctx, s.description, layout.width - P * 2), P, fy);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Brighten dark row colours a bit so coloured names stay readable on black. */
export function lighten(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 110) {
    const k = (110 - lum) / 255 + 0.25;
    r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export async function ensureFonts(sc: Showcase) {
  const ids = new Set([sc.style.titleFont, sc.style.labelFont]);
  await Promise.all([...ids].map((id) => document.fonts.load(font(id, 16, 700)).catch(() => {})));
  await Promise.all([...ids].map((id) => document.fonts.load(font(id, 16, 500)).catch(() => {})));
}

/** Loop length (ticks) that covers every animation in the showcase, capped. */
export function loopTicks(textures: Iterable<LoadedTexture | null | undefined>, speed: number, cap = 600): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let l = 1;
  for (const t of textures) {
    if (!t?.timeline) continue;
    const n = t.timeline.totalTicks;
    l = (l * n) / gcd(l, n);
    if (l > cap) return cap;
  }
  return Math.max(1, Math.round(l / Math.max(0.01, speed)));
}
