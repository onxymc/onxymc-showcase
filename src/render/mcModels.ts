// Builds three.js meshes from Minecraft Java model JSON (elements, parents, texture
// aliases, element rotations) and from flat item sprites (extruded like in-game).
import * as THREE from "three";
import type { PackView } from "../core/packView";
import { resolveModel, resolveTextureRef, pickModelId, type ResolvedModel } from "../core/resolve";
import { texturePathOf } from "../core/packView";
import { getTexture, type LoadedTexture } from "../core/packAccess";
import { sampleTimeline } from "../core/animation";

export type Lighting = "minecraft" | "studio" | "flat";
const SHADE: Record<string, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

/** One material per texture; animated textures are drawn into a CanvasTexture per tick. */
export class TexturePool {
  private mats = new Map<string, { mat: THREE.Material; tex: LoadedTexture | null; canvas?: HTMLCanvasElement; ctex?: THREE.Texture; key?: number }>();
  constructor(private packId: string, private lighting: Lighting, private tint: THREE.Color | null = null) {}
  async get(path: string | null): Promise<THREE.Material> {
    const k = path ?? "__missing__";
    const hit = this.mats.get(k);
    if (hit) return hit.mat;
    const t = path ? await getTexture(this.packId, path).catch(() => null) : null;
    const canvas = document.createElement("canvas");
    let ctex: THREE.Texture;
    if (t) {
      const fw = t.timeline?.frameW ?? t.width, fh = t.timeline?.frameH ?? t.height;
      canvas.width = fw;
      canvas.height = fh;
      canvas.getContext("2d")!.drawImage(t.bitmap, 0, 0, fw, fh, 0, 0, fw, fh);
    } else {
      // Minecraft's missing texture: magenta/black checker
      canvas.width = canvas.height = 2;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#f800f8";
      c.fillRect(0, 0, 2, 2);
      c.fillStyle = "#000";
      c.fillRect(0, 0, 1, 1);
      c.fillRect(1, 1, 1, 1);
    }
    ctex = new THREE.CanvasTexture(canvas);
    ctex.magFilter = THREE.NearestFilter;
    ctex.minFilter = THREE.NearestFilter;
    ctex.generateMipmaps = false;
    ctex.flipY = false;
    ctex.colorSpace = THREE.SRGBColorSpace;
    const common = { map: ctex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, vertexColors: this.lighting === "minecraft" };
    const mat = this.lighting === "studio" ? new THREE.MeshStandardMaterial({ ...common, roughness: 0.85, metalness: 0.05 }) : new THREE.MeshBasicMaterial(common);
    if (this.tint) (mat as any).color = this.tint;
    this.mats.set(k, { mat, tex: t, canvas, ctex });
    return mat;
  }
  /** Advance animated textures; returns true when something changed. */
  tick(tick: number): boolean {
    let changed = false;
    for (const e of this.mats.values()) {
      const tl = e.tex?.timeline;
      if (!tl || !e.canvas || !e.ctex) continue;
      const s = sampleTimeline(tl, tick);
      const key = s.key * 1000 + Math.round(s.mix * 100);
      if (key === e.key) continue;
      e.key = key;
      const c = e.canvas.getContext("2d")!;
      c.clearRect(0, 0, tl.frameW, tl.frameH);
      const draw = (i: number) => c.drawImage(e.tex!.bitmap, (i % tl.cols) * tl.frameW, Math.floor(i / tl.cols) * tl.frameH, tl.frameW, tl.frameH, 0, 0, tl.frameW, tl.frameH);
      draw(s.index);
      if (s.mix > 0) {
        c.globalAlpha = s.mix;
        draw(s.nextIndex);
        c.globalAlpha = 1;
      }
      e.ctex.needsUpdate = true;
      changed = true;
    }
    return changed;
  }
  hasAnimated() {
    return [...this.mats.values()].some((e) => e.tex?.timeline);
  }
  dispose() {
    for (const e of this.mats.values()) {
      e.mat.dispose();
      e.ctex?.dispose();
    }
    this.mats.clear();
  }
}

type V3 = [number, number, number];
const FACE_CORNERS: Record<string, (a: V3, b: V3) => V3[]> = {
  north: ([x1, y1, z1], [x2, y2]) => [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]],
  south: ([x1, y1], [x2, y2, z2]) => [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]],
  east: ([, y1, z1], [x2, y2, z2]) => [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]],
  west: ([x1, y1, z1], [, y2, z2]) => [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]],
  up: ([x1, , z1], [x2, y2, z2]) => [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]],
  down: ([x1, y1, z1], [x2, , z2]) => [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]],
};
function defaultUv(face: string, [x1, y1, z1]: V3, [x2, y2, z2]: V3): number[] {
  switch (face) {
    case "north": return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case "south": return [x1, 16 - y2, x2, 16 - y1];
    case "east": return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    case "west": return [z1, 16 - y2, z2, 16 - y1];
    case "up": return [x1, z1, x2, z2];
    default: return [x1, 16 - z2, x2, 16 - z1];
  }
}

function rotatePoint(p: V3, rot: any): V3 {
  if (!rot || typeof rot.angle !== "number" || !rot.angle) return p;
  const o: V3 = Array.isArray(rot.origin) ? rot.origin : [8, 8, 8];
  const a = (rot.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const k = rot.rescale ? 1 / Math.cos(a) : 1;
  if (rot.axis === "x") [y, z] = [y * c - z * s, y * s + z * c], (y *= k), (z *= k);
  else if (rot.axis === "y") [x, z] = [x * c + z * s, -x * s + z * c], (x *= k), (z *= k);
  else [x, y] = [x * c - y * s, x * s + y * c], (x *= k), (y *= k);
  return [x + o[0], y + o[1], z + o[2]];
}

export async function buildElementModel(view: PackView, model: ResolvedModel, pool: TexturePool, lighting: Lighting): Promise<{ group: THREE.Group; warnings: string[] }> {
  const groups = new Map<string, { pos: number[]; uv: number[]; col: number[] }>();
  const warnings: string[] = [];
  for (const el of (model.elements ?? []).slice(0, 4000)) {
    const from: V3 = el.from, to: V3 = el.to;
    if (!Array.isArray(from) || !Array.isArray(to)) continue;
    for (const [face, f] of Object.entries<any>(el.faces ?? {})) {
      if (!FACE_CORNERS[face] || !f) continue;
      const ref = typeof f.texture === "string" ? resolveTextureRef(model.textures, f.texture) : null;
      let path: string | null = ref ? texturePathOf(ref) : null;
      if (path && !view.has(path)) {
        warnings.push(`Texture ${ref} is not in this pack (vanilla textures are not bundled)`);
        path = null;
      }
      const key = path ?? "__missing__";
      if (!groups.has(key)) groups.set(key, { pos: [], uv: [], col: [] });
      const g = groups.get(key)!;
      const corners = FACE_CORNERS[face](from, to).map((p) => rotatePoint(p, el.rotation));
      const [u1, v1, u2, v2] = Array.isArray(f.uv) ? f.uv : defaultUv(face, from, to);
      let uvs = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
      const steps = (((f.rotation ?? 0) / 90) % 4 + 4) % 4;
      for (let i = 0; i < steps; i++) uvs = [uvs[3], uvs[0], uvs[1], uvs[2]];
      const shade = lighting === "minecraft" && el.shade !== false ? SHADE[face] : 1;
      for (const i of [0, 3, 2, 0, 2, 1]) {
        const p = corners[i];
        g.pos.push(p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5);
        g.uv.push(uvs[i][0] / 16, uvs[i][1] / 16);
        g.col.push(shade, shade, shade);
      }
    }
  }
  const group = new THREE.Group();
  for (const [path, g] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, await pool.get(path === "__missing__" ? null : path)));
  }
  return { group, warnings: [...new Set(warnings)] };
}

/** In-game style extruded sprite: full front/back quads + per-pixel edge walls. */
export async function buildExtrudedSprite(tex: LoadedTexture, path: string, pool: TexturePool, lighting: Lighting): Promise<THREE.Group> {
  const fw = tex.timeline?.frameW ?? tex.width, fh = tex.timeline?.frameH ?? tex.height;
  const c = new OffscreenCanvas(fw, fh);
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(tex.bitmap, 0, 0, fw, fh, 0, 0, fw, fh);
  const a = cx.getImageData(0, 0, fw, fh).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && a[(y * fw + x) * 4 + 3] > 25;
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const d = 0.5 / 16; // half a pixel each way → 1/16 thick like vanilla
  const quad = (pts: V3[], uvs: number[][], shade: number) => {
    for (const i of [0, 3, 2, 0, 2, 1]) {
      pos.push(...pts[i]);
      uv.push(...uvs[i]);
      col.push(shade, shade, shade);
    }
  };
  const sx = 1 / fw, sy = 1 / fh;
  const X = (x: number) => x * sx - 0.5, Y = (y: number) => 0.5 - y * sy;
  const sh = (f: string) => (lighting === "minecraft" ? SHADE[f] : 1);
  quad([[X(0), Y(0), d], [X(fw), Y(0), d], [X(fw), Y(fh), d], [X(0), Y(fh), d]], [[0, 0], [1, 0], [1, 1], [0, 1]], sh("south"));
  quad([[X(fw), Y(0), -d], [X(0), Y(0), -d], [X(0), Y(fh), -d], [X(fw), Y(fh), -d]], [[1, 0], [0, 0], [0, 1], [1, 1]], sh("north"));
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      if (!solid(x, y)) continue;
      const u = (x + 0.5) / fw, v = (y + 0.5) / fh;
      const t = [[u, v], [u, v], [u, v], [u, v]];
      if (!solid(x, y - 1)) quad([[X(x), Y(y), -d], [X(x + 1), Y(y), -d], [X(x + 1), Y(y), d], [X(x), Y(y), d]], t, sh("up"));
      if (!solid(x, y + 1)) quad([[X(x), Y(y + 1), d], [X(x + 1), Y(y + 1), d], [X(x + 1), Y(y + 1), -d], [X(x), Y(y + 1), -d]], t, sh("down"));
      if (!solid(x - 1, y)) quad([[X(x), Y(y), -d], [X(x), Y(y), d], [X(x), Y(y + 1), d], [X(x), Y(y + 1), -d]], t, sh("west"));
      if (!solid(x + 1, y)) quad([[X(x + 1), Y(y), d], [X(x + 1), Y(y), -d], [X(x + 1), Y(y + 1), -d], [X(x + 1), Y(y + 1), d]], t, sh("east"));
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, await pool.get(path)));
  return g;
}

export interface BuiltModel {
  group: THREE.Group;
  kind: "elements" | "sprite" | "fallback";
  note: string | null;
  display: any;
  warnings: string[];
}

/** Resolve an item (by id) or a model file path to a mesh. */
export async function buildItem(view: PackView, packId: string, target: { itemId?: string; modelPath?: string; texturePath?: string }, pool: TexturePool, lighting: Lighting): Promise<BuiltModel | null> {
  let model: ResolvedModel | null = null;
  if (target.modelPath) {
    const m = target.modelPath.match(/^assets\/([^/]+)\/models\/(.+)\.json$/);
    if (m) model = await resolveModel(view, `${m[1]}:${m[2]}`);
  } else if (target.itemId) {
    const def = await view.readJson(`assets/minecraft/items/${target.itemId}.json`);
    const id = def?.model ? pickModelId(def.model) : view.has(`assets/minecraft/models/item/${target.itemId}.json`) ? `minecraft:item/${target.itemId}` : null;
    if (id) model = await resolveModel(view, id);
  }
  if (model?.elements?.length) {
    const r = await buildElementModel(view, model, pool, lighting);
    return { group: r.group, kind: "elements", note: null, display: model.display, warnings: r.warnings };
  }
  const layer0 = model ? resolveTextureRef(model.textures, "#layer0") : null;
  const path = layer0 ? texturePathOf(layer0) : target.texturePath ?? null;
  if (path && view.has(path)) {
    const t = await getTexture(packId, path).catch(() => null);
    if (t) return { group: await buildExtrudedSprite(t, path, pool, lighting), kind: "sprite", note: null, display: model?.display, warnings: [] };
  }
  return null;
}

// ---------------------------------------------------------------- player + armor
/** Standard Minecraft "box UV" layout for a w×h×d cuboid at texture offset (u,v). */
function boxUv(geo: THREE.BoxGeometry, u: number, v: number, w: number, h: number, d: number, tw: number, th: number, mirror = false) {
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (front faces +z)
  const R = (x: number, y: number, ww: number, hh: number) => [x / tw, y / th, (x + ww) / tw, (y + hh) / th];
  let right = R(u, v + d, d, h), left = R(u + d + w, v + d, d, h);
  if (mirror) [right, left] = [left, right];
  const faces = [
    left, // +x
    right, // -x
    R(u + d, v, w, d), // top
    R(u + d + w, v, w, d), // bottom
    R(u + d, v + d, w, h), // front
    R(u + d + w + d, v + d, w, h), // back
  ];
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    let [u1, v1, u2, v2] = faces[f];
    if (mirror) [u1, u2] = [u2, u1];
    // BoxGeometry vertex order per face: (0,0)TL, (1,0)TR, (0,1)BL, (1,1)BR in uv space with flipY=false
    const corners = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]];
    if (f === 3) corners.reverse(); // bottom face is flipped in MC
    for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, corners[i][0], corners[i][1]);
  }
  uv.needsUpdate = true;
}

export interface ArmorSet {
  helmet?: string | null;
  chest?: string | null;
  legs?: string | null;
  boots?: string | null;
  leggingsTexture?: string | null;
  tint?: string | null;
}

/** Locate armor layer textures: 1.21.4+ equipment layout first, legacy models/armor second. */
export function armorTextures(view: PackView, material: string): { outer: string | null; legs: string | null } {
  const mat = material === "golden" ? "gold" : material;
  const c = (p: string) => (view.has(p) ? p : null);
  return {
    outer: c(`assets/minecraft/textures/entity/equipment/humanoid/${mat}.png`) ?? c(`assets/minecraft/textures/models/armor/${mat}_layer_1.png`),
    legs: c(`assets/minecraft/textures/entity/equipment/humanoid_leggings/${mat}.png`) ?? c(`assets/minecraft/textures/models/armor/${mat}_layer_2.png`),
  };
}

function mannequinTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#8a8f99";
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#6c717b";
  for (let i = 0; i < 64; i += 4) x.fillRect(i, 0, 1, 64);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.flipY = false;
  return t;
}

async function loadTex(packId: string, path: string | null): Promise<THREE.Texture | null> {
  if (!path) return null;
  const t = await getTexture(packId, path).catch(() => null);
  if (!t) return null;
  const c = document.createElement("canvas");
  c.width = t.timeline?.frameW ?? t.width;
  c.height = t.timeline?.frameH ?? t.height;
  c.getContext("2d")!.drawImage(t.bitmap, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function buildPlayer(view: PackView, packId: string, armor: { helmet: string | null; chest: string | null; legs: string | null; boots: string | null }, lighting: Lighting) {
  const skinPath = ["assets/minecraft/textures/entity/player/wide/steve.png", "assets/minecraft/textures/entity/steve.png"].find((p) => view.has(p)) ?? null;
  const skin = (await loadTex(packId, skinPath)) ?? mannequinTexture();
  const skinH = (skin.image as HTMLCanvasElement).height;
  const mat = (map: THREE.Texture, tint?: string | null) => {
    const m = lighting === "studio" ? new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.1, roughness: 0.9 }) : new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.1 });
    if (tint) m.color = new THREE.Color(tint);
    return m;
  };
  const root = new THREE.Group();
  const P = 1 / 16;
  const part = (map: THREE.Texture, tw: number, th: number, u: number, v: number, w: number, h: number, d: number, x: number, y: number, z: number, inflate = 0, mirror = false, tint?: string | null) => {
    const g = new THREE.BoxGeometry((w + inflate * 2) * P, (h + inflate * 2) * P, (d + inflate * 2) * P);
    boxUv(g, u, v, w, h, d, tw, th, mirror);
    const m = new THREE.Mesh(g, mat(map, tint));
    m.position.set(x * P, y * P, z * P);
    root.add(m);
    return m;
  };
  // body (y measured from feet)
  const S = (u: number, v: number, w: number, h: number, d: number, x: number, y: number, mirror = false) => part(skin, 64, skinH, u, v, w, h, d, x, y, 0, 0, mirror);
  S(0, 0, 8, 8, 8, 0, 28);
  S(16, 16, 8, 12, 4, 0, 18);
  S(40, 16, 4, 12, 4, -6, 18);
  skinH === 64 ? S(32, 48, 4, 12, 4, 6, 18) : S(40, 16, 4, 12, 4, 6, 18, true);
  S(0, 16, 4, 12, 4, -2, 6);
  skinH === 64 ? S(16, 48, 4, 12, 4, 2, 6) : S(0, 16, 4, 12, 4, 2, 6, true);

  const notes: string[] = [];
  const A = async (path: string | null, fn: (t: THREE.Texture) => void) => {
    const t = await loadTex(packId, path);
    if (t) fn(t);
  };
  // Armor textures use the 64×32 humanoid layout (any HD multiple works since UVs are relative).
  const tw = 64, th = 32;
  await A(armor.helmet, (t) => part(t, tw, th, 0, 0, 8, 8, 8, 0, 28, 0, 1));
  await A(armor.chest, (t) => {
    part(t, tw, th, 16, 16, 8, 12, 4, 0, 18, 0, 1);
    part(t, tw, th, 40, 16, 4, 12, 4, -6, 18, 0, 1);
    part(t, tw, th, 40, 16, 4, 12, 4, 6, 18, 0, 1, true);
  });
  await A(armor.legs, (t) => {
    part(t, tw, th, 16, 16, 8, 12, 4, 0, 18, 0, 0.5);
    part(t, tw, th, 0, 16, 4, 12, 4, -2, 6, 0, 0.5);
    part(t, tw, th, 0, 16, 4, 12, 4, 2, 6, 0, 0.5, true);
  });
  await A(armor.boots, (t) => {
    part(t, tw, th, 0, 16, 4, 12, 4, -2, 6, 0, 1);
    part(t, tw, th, 0, 16, 4, 12, 4, 2, 6, 0, 1, true);
  });
  if (!skinPath) notes.push("No player skin in this pack — showing a neutral mannequin.");
  root.position.y = -16 * P;
  return { group: root, notes };
}
