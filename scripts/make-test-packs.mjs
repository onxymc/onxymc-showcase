// Generates original, procedurally drawn demo resource packs for testing:
// colour variants, an animated .png.mcmeta texture, a 1.21.4+ item definition,
// a Skyboxify/OptiFine sky, and a deliberately malicious zip entry.
// Usage: node scripts/make-test-packs.mjs <outDir>
import { PNG } from "pngjs";
import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "test-packs";
fs.mkdirSync(out, { recursive: true });

const MASKS = {
  sword: [
    "..............##",
    ".............#o#",
    "............#ox#",
    "...........#ox#.",
    "..........#ox#..",
    ".........#ox#...",
    "........#ox#....",
    "..##...#ox#.....",
    "..#o#.#ox#......",
    "...#o#ox#.......",
    "....#oo#........",
    "....##o#........",
    "...#hh##o#......",
    "..#hh#..##......",
    "##h#............",
    "##..............",
  ],
  axe: [
    "................",
    ".....####.......",
    "....#oxxx#......",
    "...#oxxxxx#.....",
    "...#oxx##x#.....",
    "....#x#hh#x#....",
    ".....##hh#x#....",
    "......#hh###....",
    ".....#hh#.......",
    "....#hh#........",
    "...#hh#.........",
    "..#hh#..........",
    ".#hh#...........",
    "#hh#............",
    "##..............",
    "................",
  ],
  helmet: [
    "................",
    "................",
    "................",
    "....########....",
    "...#oooxxxxx#...",
    "..#oxxxxxxxxx#..",
    "..#oxxxxxxxxx#..",
    "..#ox######xx#..",
    "..#x#......#x#..",
    "..#x#......#x#..",
    "..###......###..",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  chest: [
    "................",
    "..####....####..",
    ".#oxx#....#xxx#.",
    ".#oxxx####xxxx#.",
    ".#oxxxxxxxxxxx#.",
    ".###oxxxxxxx###.",
    "...#oxxxxxxx#...",
    "...#oxxxxxxx#...",
    "...#oxxxxxxx#...",
    "...#oxxxxxxx#...",
    "...#oxxxxxxx#...",
    "...#xxxxxxxx#...",
    "...##########...",
    "................",
    "................",
    "................",
  ],
  apple: [
    "................",
    "........#.......",
    ".......#h#......",
    "....###h####....",
    "...#ooxxxxxx#...",
    "..#oooxxxxxxx#..",
    "..#ooxxxxxxxx#..",
    "..#oxxxxxxxxx#..",
    "..#xxxxxxxxxx#..",
    "..#xxxxxxxxxx#..",
    "..#xxxxxxxxxx#..",
    "...#xxxxxxxx#...",
    "....#xx##xx#....",
    ".....##..##.....",
    "................",
    "................",
  ],
  pearl: [
    "................",
    "................",
    "................",
    ".....######.....",
    "....#oooxxx#....",
    "...#ooxxxxxx#...",
    "...#oxx##xxx#...",
    "...#xx#..#xx#...",
    "...#xx#..#xx#...",
    "...#xxx##xxx#...",
    "...#xxxxxxxx#...",
    "....#xxxxxx#....",
    ".....######.....",
    "................",
    "................",
    "................",
  ],
  totem: [
    "................",
    ".....######.....",
    "....#oxxxxx#....",
    "....#x#xx#x#....",
    "....#xxxxxx#....",
    "....#x####x#....",
    "..###xxxxxx###..",
    ".#oxxxxxxxxxxx#.",
    "..###xxxxxx###..",
    "....#oxxxxx#....",
    "....#xxxxxx#....",
    "....#xx##xx#....",
    "....#xx##xx#....",
    ".....##..##.....",
    "................",
    "................",
  ],
  mace: [
    "..........####..",
    ".........#oxxx#.",
    "........#oxxxxx#",
    "........#xx##xx#",
    "........#xx##xx#",
    ".........#xxxx#.",
    "........#h####..",
    ".......#hh#.....",
    "......#hh#......",
    ".....#hh#.......",
    "....#hh#........",
    "...#hh#.........",
    "..#hh#..........",
    ".#hh#...........",
    "#hh#............",
    "##..............",
  ],
};
const HEART = [
  ".##.##...",
  "#oo#xx#..",
  "#oxxxx#..",
  "#xxxxx#..",
  ".#xxx#...",
  "..#x#....",
  "...#.....",
  ".........",
  ".........",
];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function drawMask(mask, base, { w = 16, h = 16, png, ox = 0, oy = 0, shift = 0 } = {}) {
  const img = png ?? new PNG({ width: w, height: h });
  const dark = mix(base, [0, 0, 0], 0.65), light = mix(base, [255, 255, 255], 0.55), handle = [70, 48, 30];
  mask.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === ".") return;
    let col = c === "#" ? dark : c === "o" ? light : c === "h" ? handle : base;
    if (c === "x" && shift) col = mix(base, [255, 255, 255], ((x + y + shift) % 4 === 0) ? 0.35 : 0);
    const i = ((oy + y) * img.width + (ox + x)) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }));
  return img;
}
const png = (img) => new Uint8Array(PNG.sync.write(img));

function animatedStrip(mask, base, frames) {
  const img = new PNG({ width: 16, height: 16 * frames });
  for (let f = 0; f < frames; f++) drawMask(mask, base, { png: img, oy: f * 16, shift: f + 1 });
  return png(img);
}

function skySheet(top, bottom) {
  const W = 384, H = 256, img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const face = Math.floor(x / 128) + 3 * Math.floor(y / 128);
    const ly = (y % 128) / 127;
    // 0 bottom, 1 top, 2..5 sides — sides get a vertical gradient + "stars"
    let c = face === 1 ? top : face === 0 ? bottom : mix(top, bottom, ly);
    if (face !== 0 && ((x * 7919 + y * 104729) % 997) === 0) c = [255, 255, 255];
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  return png(img);
}

const TI = "assets/minecraft/textures/item/";
function makePack(name, color, opts = {}) {
  const c = hex(color);
  const files = {
    "pack.mcmeta": strToU8(JSON.stringify({ pack: { pack_format: 75, min_format: [75, 0], max_format: [75, 0], description: { text: `${name} demo pack`, color: "gray" } } })),
    "pack.png": png(drawMask(MASKS.sword, c)),
    [`${TI}netherite_sword.png`]: png(drawMask(MASKS.sword, c)),
    [`${TI}netherite_axe.png`]: png(drawMask(MASKS.axe, c)),
    [`${TI}mace.png`]: png(drawMask(MASKS.mace, c)),
    [`${TI}netherite_helmet.png`]: png(drawMask(MASKS.helmet, c)),
    [`${TI}netherite_chestplate.png`]: png(drawMask(MASKS.chest, c)),
    [`${TI}golden_apple.png`]: png(drawMask(MASKS.apple, c)),
    [`${TI}ender_pearl.png`]: png(drawMask(MASKS.pearl, c)),
    "assets/minecraft/textures/gui/sprites/hud/heart/full.png": png(drawMask(HEART, c, { w: 9, h: 9 })),
    "assets/minecraft/textures/gui/sprites/hud/heart/hardcore_full.png": png(drawMask(HEART, mix(c, [255, 255, 255], 0.3), { w: 9, h: 9 })),
  };
  if (opts.animated) {
    // 4-frame animated sword, frametime 3 ticks, custom frame order with a long hold.
    files[`${TI}netherite_sword.png`] = animatedStrip(MASKS.sword, c, 4);
    files[`${TI}netherite_sword.png.mcmeta`] = strToU8(JSON.stringify({ animation: { frametime: 3, interpolate: !!opts.interpolate, frames: [0, 1, 2, { index: 3, time: 10 }] } }));
  }
  if (opts.itemDefinition) {
    // 1.21.4+ item definition redirecting the totem to a custom model + texture
    files["assets/minecraft/items/totem_of_undying.json"] = strToU8(JSON.stringify({ model: { type: "minecraft:select", property: "minecraft:display_context", cases: [], fallback: { type: "minecraft:model", model: "onxy:item/fancy_totem" } } }));
    files["assets/onxy/models/item/fancy_totem.json"] = strToU8(JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: "onxy:item/fancy_totem" } }));
    files["assets/onxy/textures/item/fancy_totem.png"] = png(drawMask(MASKS.totem, c));
  } else files[`${TI}totem_of_undying.png`] = png(drawMask(MASKS.totem, c));
  if (opts.sky) {
    files["assets/minecraft/optifine/sky/world0/sky1.properties"] = strToU8(`# day layer\nsource=./sky1.png\nblend=alpha\nstartFadeIn=5:00\nendFadeIn=6:00\nendFadeOut=19:00\nrotate=true\nspeed=1\naxis=0.0 0.0 1.0\n`);
    files["assets/minecraft/optifine/sky/world0/sky1.png"] = skySheet(mix(c, [0, 0, 0], 0.7), mix(c, [255, 255, 255], 0.2));
    files["assets/minecraft/optifine/sky/world0/sky2.properties"] = strToU8(`source=minecraft:optifine/sky/world0/night.png\nblend=add\nstartFadeIn=18:00\nendFadeIn=19:00\nstartFadeOut=4:00\nendFadeOut=5:00\n`);
    files["assets/minecraft/optifine/sky/world0/night.png"] = skySheet([5, 5, 20], [20, 10, 40]);
  }
  if (opts.armor) {
    // 1.21.4+ equipment layers (64×32 humanoid layout), procedurally filled
    const layer = (shade) => {
      const img = new PNG({ width: 64, height: 32 });
      for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4, edge = (x + y) % 7 === 0;
        const col = edge ? mix(c, [255, 255, 255], 0.35) : mix(c, [0, 0, 0], shade + ((x * 3 + y) % 5) * 0.04);
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
      return png(img);
    };
    files["assets/minecraft/textures/entity/equipment/humanoid/netherite.png"] = layer(0.1);
    files["assets/minecraft/textures/entity/equipment/humanoid_leggings/netherite.png"] = layer(0.35);
  }
  if (opts.malicious) {
    files["../../evil.txt"] = strToU8("path traversal attempt");
    files["assets/minecraft/textures/item/run_me.bat"] = strToU8("echo should never execute");
  }
  return zipSync(files, { level: 6 });
}

const VARIANTS = [
  ["Crimson", "#8A0C05", { animated: true, interpolate: true, sky: true, armor: true }],
  ["Blossom", "#C2457A", { sky: true }],
  ["Violet", "#6A2BC4", { animated: true, itemDefinition: true, sky: true }],
  ["Void", "#2A2A33", {}],
  ["Divine", "#D9A21B", { itemDefinition: true, sky: true }],
  ["Ghost", "#D8DBE0", { malicious: true }],
];
for (const [n, c, o] of VARIANTS) {
  const f = path.join(out, `Onxy Demo ${n}.zip`);
  fs.writeFileSync(f, makePack(n, c, o));
  console.log("wrote", f);
}
// A pack zipped with an extra top-level folder (common when users zip the folder itself)
{
  const inner = makePack("Nested", "#3B82F6", {});
  const { unzipSync } = await import("fflate");
  const files = unzipSync(inner);
  const nested = {};
  for (const [k, v] of Object.entries(files)) nested[`Nested Pack/${k}`] = v;
  fs.writeFileSync(path.join(out, "Onxy Demo Nested.zip"), zipSync(nested));
}
