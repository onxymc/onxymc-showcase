// Catalog of showcase-able Minecraft Java textures (1.21.11 layout first, older paths as fallbacks).
// `itemId` lets the resolver follow 1.21.4+ item definitions and item models inside the pack.

export type CatalogCategory = "Weapons" | "Tools" | "Armor" | "PvP" | "Food" | "Blocks" | "HUD" | "Particles" | "Misc";

export interface CatalogItem {
  key: string;
  label: string;
  category: CatalogCategory;
  itemId?: string;
  candidates: string[];
}

const T = "assets/minecraft/textures/";
const item = (id: string, label: string, category: CatalogCategory, extra: string[] = []): CatalogItem => ({
  key: id,
  label,
  category,
  itemId: id,
  candidates: [`${T}item/${id}.png`, `${T}items/${id}.png`, ...extra],
});
const tex = (key: string, label: string, category: CatalogCategory, paths: string[]): CatalogItem => ({
  key,
  label,
  category,
  candidates: paths.map((p) => T + p),
});

const MATERIALS = ["netherite", "diamond", "iron", "golden", "stone", "wooden"] as const;
const ARMOR = ["netherite", "diamond", "iron", "golden", "chainmail", "leather"] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const CATALOG: CatalogItem[] = [
  ...MATERIALS.flatMap((m) => [
    item(`${m}_sword`, `${cap(m)} Sword`, "Weapons"),
    item(`${m}_axe`, `${cap(m)} Axe`, "Weapons"),
    item(`${m}_spear`, `${cap(m)} Spear`, "Weapons"),
    item(`${m}_pickaxe`, `${cap(m)} Pickaxe`, "Tools"),
    item(`${m}_shovel`, `${cap(m)} Shovel`, "Tools"),
    item(`${m}_hoe`, `${cap(m)} Hoe`, "Tools"),
  ]),
  item("copper_spear", "Copper Spear", "Weapons"),
  item("mace", "Mace", "Weapons"),
  item("trident", "Trident", "Weapons"),
  item("bow", "Bow", "Weapons"),
  item("crossbow_standby", "Crossbow", "Weapons"),
  item("arrow", "Arrow", "Weapons"),
  ...ARMOR.flatMap((m) => [
    item(`${m}_helmet`, `${cap(m)} Helmet`, "Armor"),
    item(`${m}_chestplate`, `${cap(m)} Chestplate`, "Armor"),
    item(`${m}_leggings`, `${cap(m)} Leggings`, "Armor"),
    item(`${m}_boots`, `${cap(m)} Boots`, "Armor"),
  ]),
  item("turtle_helmet", "Turtle Shell", "Armor"),
  item("elytra", "Elytra", "Armor"),
  tex("shield", "Shield", "PvP", ["entity/shield/base_nopattern.png", "entity/shield_base_nopattern.png", "item/shield.png"]),
  item("totem_of_undying", "Totem of Undying", "PvP"),
  item("ender_pearl", "Ender Pearl", "PvP"),
  item("end_crystal", "End Crystal", "PvP"),
  tex("respawn_anchor", "Respawn Anchor", "PvP", ["block/respawn_anchor_side4.png", "block/respawn_anchor_top.png"]),
  item("wind_charge", "Wind Charge", "PvP"),
  item("fishing_rod", "Fishing Rod", "PvP"),
  item("snowball", "Snowball", "PvP"),
  item("splash_potion", "Splash Potion", "PvP"),
  item("experience_bottle", "Bottle o' Enchanting", "PvP"),
  item("firework_rocket", "Firework Rocket", "PvP"),
  item("ender_eye", "Eye of Ender", "PvP"),
  item("golden_apple", "Golden Apple", "Food"),
  item("enchanted_golden_apple", "Enchanted Golden Apple", "Food", [`${T}item/golden_apple.png`]),
  item("golden_carrot", "Golden Carrot", "Food"),
  item("cooked_beef", "Steak", "Food"),
  item("apple", "Apple", "Food"),
  tex("obsidian", "Obsidian", "Blocks", ["block/obsidian.png"]),
  tex("cobweb", "Cobweb", "Blocks", ["block/cobweb.png"]),
  tex("glowstone", "Glowstone", "Blocks", ["block/glowstone.png"]),
  tex("tnt", "TNT", "Blocks", ["block/tnt_side.png"]),
  tex("crying_obsidian", "Crying Obsidian", "Blocks", ["block/crying_obsidian.png"]),
  tex("heart", "Heart", "HUD", ["gui/sprites/hud/heart/full.png"]),
  tex("heart_hardcore", "Hardcore Heart", "HUD", ["gui/sprites/hud/heart/hardcore_full.png"]),
  tex("heart_absorbing", "Absorption Heart", "HUD", ["gui/sprites/hud/heart/absorbing_full.png"]),
  tex("heart_container", "Heart Container", "HUD", ["gui/sprites/hud/heart/container.png"]),
  tex("food_full", "Hunger", "HUD", ["gui/sprites/hud/food_full.png"]),
  tex("armor_full", "Armor Point", "HUD", ["gui/sprites/hud/armor_full.png"]),
  tex("crosshair", "Crosshair", "HUD", ["gui/sprites/hud/crosshair.png"]),
  tex("hotbar_selection", "Hotbar Selection", "HUD", ["gui/sprites/hud/hotbar_selection.png"]),
  tex("particle_crit", "Critical Hit", "Particles", ["particle/critical_hit.png"]),
  tex("particle_enchanted_hit", "Enchanted Hit", "Particles", ["particle/enchanted_hit.png"]),
  tex("particle_sweep", "Sweep Attack", "Particles", ["particle/sweep_0.png"]),
  tex("particle_damage", "Damage", "Particles", ["particle/damage.png"]),
  tex("particle_totem", "Totem Glitter", "Particles", ["particle/glitter_7.png", "particle/glitter_0.png"]),
  tex("particle_heart", "Heart Particle", "Particles", ["particle/heart.png"]),
  tex("enchant_glint", "Enchant Glint", "Misc", ["misc/enchanted_glint_item.png", "misc/enchanted_item_glint.png"]),
  tex("fire", "Fire", "Misc", ["block/fire_0.png"]),
];

export const CATALOG_BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));

/** Special column key that renders the pack's sky preview. */
export const SKY_COLUMN = "__sky__";
export const CUSTOM_PREFIX = "custom:";

export function columnLabel(key: string): string {
  if (key === SKY_COLUMN) return "Sky";
  if (key.startsWith(CUSTOM_PREFIX)) return key.slice(CUSTOM_PREFIX.length).split("/").pop()!.replace(/\.png$/, "");
  return CATALOG_BY_KEY.get(key)?.label ?? key;
}

/** Kino-style default columns. */
export const DEFAULT_COLUMNS = [
  "netherite_sword", "netherite_axe", "netherite_spear", "mace", "netherite_helmet", "netherite_chestplate",
  "netherite_leggings", "netherite_boots", "totem_of_undying", "ender_pearl", "golden_apple", "heart", "heart_hardcore", SKY_COLUMN,
];
