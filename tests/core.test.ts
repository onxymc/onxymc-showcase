import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { indexZip, readZipEntries, sanitizeEntryPath } from "../src/core/safeZip";
import { PackView, type RawAccess } from "../src/core/packView";
import { scanPack } from "../src/core/scanner";
import { resolveItemTexture, pickModelId } from "../src/core/resolve";
import { parseMcmeta, formatToVersionLabel, parseLenientJson } from "../src/core/packMeta";
import { parseAnimationMeta, buildTimeline, sampleTimeline } from "../src/core/animation";
import { parseSkyLayer, toTickTime, fadeAlpha, loadSkyLayers, parseProperties } from "../src/core/sky";

function zipAccess(bytes: Uint8Array): RawAccess {
  const idx = indexZip(bytes);
  return { files: [...idx.entries.keys()], read: async (p) => readZipEntries(bytes, p) };
}
const pack = (n: string) => new Uint8Array(fs.readFileSync(`test-packs/Onxy Demo ${n}.zip`));

describe("safe zip", () => {
  it("rejects traversal and absolute paths", () => {
    expect(sanitizeEntryPath("../../evil.txt")).toBeNull();
    expect(sanitizeEntryPath("a/../../b")).toBeNull();
    expect(sanitizeEntryPath("/etc/passwd")).toBeNull();
    expect(sanitizeEntryPath("C:\\Windows\\x")).toBeNull();
    expect(sanitizeEntryPath("a\\b//./c.png")).toBe("a/b/c.png");
  });
  it("indexes the malicious pack without the traversal entry", () => {
    const idx = indexZip(pack("Ghost"));
    expect(idx.rejected).toContain("../../evil.txt");
    expect([...idx.entries.keys()].some((k) => k.includes("evil"))).toBe(false);
  });
  it("refuses oversized decompressed entries (zip bomb)", () => {
    const big = new Uint8Array(70 * 1024 * 1024); // compresses to almost nothing
    const z = zipSync({ "pack.mcmeta": strToU8("{}"), "bomb.png": big }, { level: 9 });
    const idx = indexZip(z);
    expect(idx.entries.has("bomb.png")).toBe(false);
    expect(readZipEntries(z, ["bomb.png"]).size).toBe(0);
  });
});

describe("pack.mcmeta", () => {
  it("parses 1.21.11 min/max format and text-component descriptions", () => {
    const m = parseMcmeta(JSON.stringify({ pack: { min_format: [75, 0], max_format: [75, 0], description: [{ text: "§cHi " }, { text: "there" }] } }));
    expect(m.format.versionLabel).toBe("1.21.11");
    expect(m.format.supports12111).toBe(true);
    expect(m.description).toBe("Hi there");
  });
  it("labels ranges and old formats", () => {
    expect(formatToVersionLabel(34, 34)).toBe("1.21 – 1.21.1");
    expect(formatToVersionLabel(46, 75)).toBe("1.21.4 – 1.21.11");
    expect(parseMcmeta(JSON.stringify({ pack: { pack_format: 8 } })).format.supports12111).toBe(false);
  });
  it("tolerates comments, trailing commas and junk", () => {
    expect(parseLenientJson('{"a":1, // c\n "b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
    expect(parseMcmeta("{not json").warnings[0]).toMatch(/not valid JSON/);
  });
});

describe("scanner + resolver", () => {
  it("scans the animated/sky pack", async () => {
    const v = await PackView.open(zipAccess(pack("Crimson")));
    const s = await scanPack(v);
    expect(s.animatedTextures).toEqual(["assets/minecraft/textures/item/netherite_sword.png"]);
    expect(s.skyLayers.length).toBe(2);
    expect(v.meta.format.versionLabel).toBe("1.21.11");
  });
  it("handles packs zipped inside an extra folder", async () => {
    const v = await PackView.open(zipAccess(pack("Nested")));
    expect(v.prefix).toBe("Nested Pack/");
    expect(v.has("assets/minecraft/textures/item/mace.png")).toBe(true);
  });
  it("follows 1.21.4+ item definitions to a custom model texture", async () => {
    const v = await PackView.open(zipAccess(pack("Violet")));
    const r = await resolveItemTexture(v, "totem_of_undying");
    expect(r).toMatchObject({ path: "assets/onxy/textures/item/fancy_totem.png", via: "item-definition" });
    expect(await resolveItemTexture(v, "mace")).toMatchObject({ via: "direct" });
    expect(await resolveItemTexture(v, "elytra")).toBeNull();
  });
  it("picks fallback models from select/condition nodes", () => {
    expect(pickModelId({ type: "condition", on_true: { type: "model", model: "a" }, on_false: { type: "model", model: "b" } })).toBe("b");
  });
  it("applies overlays for the target format", async () => {
    const z = zipSync({
      "pack.mcmeta": strToU8(JSON.stringify({ pack: { pack_format: 34, min_format: 34, max_format: 75 }, overlays: { entries: [{ formats: [70, 80], directory: "ov_new" }, { formats: [1, 10], directory: "ov_old" }] } })),
      "assets/minecraft/textures/item/mace.png": strToU8("base"),
      "ov_new/assets/minecraft/textures/item/mace.png": strToU8("new"),
      "ov_old/assets/minecraft/textures/item/apple.png": strToU8("old"),
    });
    const v = await PackView.open(zipAccess(z));
    expect(new TextDecoder().decode((await v.readBytes(["assets/minecraft/textures/item/mace.png"])).get("assets/minecraft/textures/item/mace.png"))).toBe("new");
    expect(v.has("assets/minecraft/textures/item/apple.png")).toBe(false);
  });
});

describe("animation timing (vanilla rules)", () => {
  it("defaults to square frames and frametime 1", () => {
    const tl = buildTimeline(parseAnimationMeta({ animation: {} })!, 16, 64) as any;
    expect(tl.frames.length).toBe(4);
    expect(tl.totalTicks).toBe(4);
  });
  it("respects custom frames and per-frame time", () => {
    const meta = parseAnimationMeta({ animation: { frametime: 3, frames: [0, 1, 2, { index: 3, time: 10 }] } })!;
    const tl = buildTimeline(meta, 16, 64) as any;
    expect(tl.totalTicks).toBe(19);
    expect(sampleTimeline(tl, 0).index).toBe(0);
    expect(sampleTimeline(tl, 8).index).toBe(2);
    expect(sampleTimeline(tl, 9).index).toBe(3);
    expect(sampleTimeline(tl, 18).index).toBe(3);
    expect(sampleTimeline(tl, 19).index).toBe(0); // loops
  });
  it("interpolates per tick", () => {
    const tl = buildTimeline(parseAnimationMeta({ animation: { frametime: 4, interpolate: true } })!, 16, 32) as any;
    const s = sampleTimeline(tl, 2);
    expect(s.index).toBe(0);
    expect(s.nextIndex).toBe(1);
    expect(s.mix).toBeCloseTo(0.5);
  });
  it("supports explicit width/height (non-square frames) and rejects bad sizes", () => {
    const tl = buildTimeline(parseAnimationMeta({ animation: { width: 8, height: 16 } })!, 32, 32) as any;
    expect(tl.frames.length).toBe(8);
    expect("error" in (buildTimeline(parseAnimationMeta({ animation: { width: 5 } })!, 16, 16) as any)).toBe(true);
  });
});

describe("Skyboxify sky format", () => {
  it("converts times exactly like Skyboxify", () => {
    expect(toTickTime("6:00")).toBe(0);
    expect(toTickTime("18:00")).toBe(12000);
    expect(toTickTime("0:00")).toBe(18000);
    expect(toTickTime("19:30")).toBe(13500);
    expect(toTickTime("25:00")).toBe(-1);
  });
  it("parses layer and computes fades", () => {
    const l = parseSkyLayer("assets/minecraft/optifine/sky/world0/sky1.properties", "source=./sky1.png\nblend=alpha\nstartFadeIn=5:00\nendFadeIn=6:00\nendFadeOut=19:00\naxis=0.0 0.0 1.0")!;
    expect(l.texturePath).toBe("assets/minecraft/optifine/sky/world0/sky1.png");
    expect(l.axis).toEqual([1, 0, -0]);
    expect(fadeAlpha(l.fade, 6000)).toBe(1); // noon
    expect(fadeAlpha(l.fade, 18000)).toBe(0); // midnight
    expect(fadeAlpha(l.fade, 23500)).toBeCloseTo(0.5); // 5:30
  });
  it("loads layers from a pack in Skyboxify order", async () => {
    const v = await PackView.open(zipAccess(pack("Crimson")));
    const layers = await loadSkyLayers(v);
    expect(layers.map((l) => l.texturePath.split("/").pop())).toEqual(["sky1.png", "night.png"]);
  });
  it("parses .properties continuations and comments", () => {
    expect(parseProperties("# c\n! c\na = 1\nb:2\nc=x\\\n  y")).toEqual({ a: "1", b: "2", c: "xy" });
  });
});
