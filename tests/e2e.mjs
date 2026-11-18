// Browser end-to-end test (Chrome via Playwright) against the built app.
// Usage: node tests/e2e.mjs [baseUrl]  — writes screenshots to tests/shots/
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const shots = "tests/shots";
fs.mkdirSync(shots, { recursive: true });
const packs = fs.readdirSync("test-packs").filter((f) => f.endsWith(".zip")).map((f) => path.resolve("test-packs", f));

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log("ok");
};
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png` });
const nav = (id) => page.click(`[data-nav="${id}"]`);

await page.goto(base);
await step("dashboard renders empty state", async () => {
  await page.getByText("No texture packs yet").waitFor();
  await shot("01-dashboard-empty");
});

await step("import 7 zip packs (incl. malicious + nested)", async () => {
  const fc = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).first().click();
  await (await fc).setFiles(packs);
  await page.waitForFunction(() => document.querySelectorAll("[data-pack]").length >= 4, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("02-dashboard");
});

await step("library grid + pack detail", async () => {
  await nav("library");
  await page.waitForFunction(() => document.querySelectorAll("[data-pack]").length === 7, null, { timeout: 15000 });
  await shot("03-library");
  await page.click('[data-pack="Onxy Demo Ghost"]');
  await page.getByText("Pack information").waitFor();
  await shot("04-pack-detail");
  const txt = await page.locator(".modal").innerText();
  if (!/1\.21\.11/.test(txt)) throw new Error("version label missing");
  if (/evil/.test(txt)) throw new Error("traversal entry leaked");
  await page.keyboard.press("Escape");
});

await step("list view", async () => {
  await page.click('button[title="List view"]');
  await page.waitForTimeout(300);
  await shot("05-library-list");
  await page.click('button[title="Grid view"]');
});

await step("create Kino-style variant showcase", async () => {
  await nav("creator");
  await page.getByRole("button", { name: "Create New Showcase" }).first().click();
  const modal = page.locator(".modal");
  await modal.locator("input.input").first().fill("Onxy Ribbon — Colour Variants");
  // select all variant packs (first is preselected)
  for (const n of ["Crimson", "Blossom", "Violet", "Void", "Divine", "Ghost"]) {
    const t = modal.locator(".template", { hasText: `Onxy Demo ${n}` });
    if (!(await t.getAttribute("class")).includes(" on")) await t.click();
  }
  await modal.locator(".template", { hasText: "Classic Kino-style" }).click();
  await page.getByRole("button", { name: "Create showcase" }).click();
  await page.locator('[data-testid="showcase-canvas"]').waitFor();
  await page.waitForTimeout(2500);
  await shot("06-creator-kino");
});

await step("edit row name/colour + undo/redo", async () => {
  await page.locator('[data-row="Onxy Demo Crimson"]').click();
  const name = page.locator(".side.right input.input").first();
  await name.fill("Crimson");
  await page.waitForTimeout(900);
  await page.locator('[data-row="Onxy Demo Blossom"]').click();
  await page.locator(".side.right input.input").first().fill("Blossom");
  await page.waitForTimeout(400);
  await page.click('button[title="Undo (Ctrl+Z)"]');
  if (!(await page.locator('[data-row="Onxy Demo Blossom"]').count())) throw new Error("undo failed");
  await page.click('button[title="Redo (Ctrl+Y)"]');
  if (!(await page.locator('[data-row="Blossom"]').count())) throw new Error("redo failed");
});

await step("animated cell actually changes over time", async () => {
  const c = page.locator('[data-testid="showcase-canvas"]');
  const a = await c.screenshot();
  await page.waitForTimeout(700);
  const b = await c.screenshot();
  if (Buffer.compare(a, b) === 0) throw new Error("canvas did not animate");
});

await step("switch to Modern Dark template with sky column", async () => {
  await page.locator(".side.right").getByRole("button", { name: "Style" }).click();
  await page.locator(".side.right .sec select").first().selectOption("modern-dark");
  await page.getByRole("button", { name: "Apply & replace items" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Fit" }).click();
  await page.waitForTimeout(600);
  await shot("07-creator-modern");
});

await step("item picker search + add", async () => {
  await page.getByRole("button", { name: "Add items" }).click();
  await page.locator(".modal input.input").fill("apple");
  await page.locator('.item-tile[title="enchanted_golden_apple"]').click();
  await shot("08-item-picker");
  await page.getByRole("button", { name: /Add 1 item/ }).click();
});

await step("export PNG 2x (download)", async () => {
  await page.getByRole("button", { name: "Export" }).click();
  const dl = page.waitForEvent("download");
  await page.locator(".modal footer").getByRole("button", { name: "Export" }).click();
  const d = await dl;
  const p = `${shots}/export.png`;
  await d.saveAs(p);
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  console.log(`(${b.readUInt32BE(16)}×${b.readUInt32BE(20)}) `);
});

await step("export GIF (auto loop)", async () => {
  await page.getByRole("button", { name: "Export" }).click();
  await page.locator(".modal select").first().selectOption("gif");
  await page.locator(".modal select").nth(1).selectOption("native");
  const dl = page.waitForEvent("download", { timeout: 120000 });
  await page.locator(".modal footer").getByRole("button", { name: "Export" }).click();
  const d = await dl;
  await d.saveAs(`${shots}/export.gif`);
  const b = fs.readFileSync(`${shots}/export.gif`);
  if (b.toString("ascii", 0, 6) !== "GIF89a") throw new Error("not a GIF");
});

await step("export video (WebCodecs)", async () => {
  await page.getByRole("button", { name: "Export" }).click();
  await page.locator(".modal select").first().selectOption("video");
  await page.waitForTimeout(500);
  const label = await page.locator(".modal select").first().locator("option:checked").innerText();
  const btn = page.locator(".modal footer").getByRole("button", { name: "Export" });
  if (await btn.isDisabled()) {
    console.log(`(skipped: ${label}) `);
    await page.keyboard.press("Escape");
    return;
  }
  await page.locator(".modal select").nth(1).selectOption("youtube");
  const dl = page.waitForEvent("download", { timeout: 180000 });
  await btn.click();
  const d = await dl;
  await d.saveAs(`${shots}/export-video.bin`);
  console.log(`(${d.suggestedFilename()}) `);
});

await step("animations player", async () => {
  await nav("animations");
  await page.locator(".anim-stage canvas").waitFor();
  await page.waitForTimeout(500);
  await page.click('button[title="Pause"]');
  const label = () => page.locator(".panel .mono").first().innerText();
  const before = +(await label()).match(/frame (\d)\/4/)[1];
  await page.click('button[title="Next frame"]');
  const after = +(await label()).match(/frame (\d)\/4/)[1];
  if (after !== (before % 4) + 1) throw new Error(`frame step ${before} -> ${after}`);
  await page.waitForTimeout(400);
  if (+(await label()).match(/frame (\d)\/4/)[1] !== after) throw new Error("still playing after pause");
  await shot("09-animations");
});

await step("skybox preview", async () => {
  await nav("skybox");
  await page.waitForTimeout(2500);
  await shot("10-skybox-day");
  await page.getByRole("button", { name: "Night" }).click();
  await page.waitForTimeout(1200);
  await shot("11-skybox-night");
});

await step("3D preview", async () => {
  await nav("models");
  await page.waitForTimeout(3000);
  await shot("12-3d-item");
  const sel = page.locator(".panel.pad.col").last().locator("select");
  await page.locator(".topbar select").selectOption({ label: "Onxy Demo Crimson" });
  await page.waitForTimeout(1500);
  await shot("12b-3d-crimson-sword");
  await sel.first().selectOption("armor");
  await page.waitForTimeout(2000);
  await shot("13-3d-armor");
});

await step("appearance themes", async () => {
  await nav("appearance");
  await page.click('[data-theme="violet"]');
  await page.waitForTimeout(300);
  await shot("14-appearance-violet");
  await page.click('[data-theme="christmas"]');
  await nav("dashboard");
  await page.waitForTimeout(500);
  await shot("15-dashboard-christmas");
  await nav("appearance");
  await page.click('[data-theme="onxy-red"]');
});

await step("settings + community + install views render", async () => {
  await nav("settings");
  await page.getByRole("tab", { name: "Performance" }).click();
  await shot("16-settings-perf");
  await nav("community");
  await page.getByText("Join the OnxyMc Discord").waitFor();
  await nav("install");
  await page.getByText("Resource packs folder").waitFor();
});

await step("persistence across reload", async () => {
  await page.waitForTimeout(1500);
  await page.reload();
  await nav("creator");
  await page.locator('[data-showcase="Onxy Ribbon — Colour Variants"]').waitFor({ timeout: 10000 });
  await page.locator('[data-showcase="Onxy Ribbon — Colour Variants"]').click();
  await page.waitForTimeout(2500);
  await shot("17-after-reload");
});

await browser.close();
const relevant = errors.filter((e) => !/favicon/.test(e));
if (relevant.length) {
  console.log("\nBrowser errors:\n" + relevant.join("\n"));
  process.exit(1);
}
console.log("\nAll E2E steps passed.");
