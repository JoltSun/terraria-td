// Shared app state: the game data and player settings that several panels read and change.
//
// Why setters: an ES module can READ another module's exported variables (live, always current),
// but it can't REASSIGN them. So any reassignment (team = [...]) goes through a setter here.
// Changing things in place (team[i] = …, loadouts[name] = …, account.x = …) works from anywhere.
import { DEFAULT_ACCOUNT } from './calc.js';

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- game data: loaded once at startup ----------
export let D = null;      // units, upgrades, items, enemies… (data.js loadAll)
export let ICONS = {};    // icons/manifest.json: category -> name -> path
export let TAGS = {};     // enemy name -> tags (night, boss, slime…)
export let SPAWNS = [];   // act spawn rows
export let BGS = {};      // backgrounds/manifest.json: biome -> pictures
export function setData(parts) {
  if ('D' in parts) D = parts.D;
  if ('ICONS' in parts) ICONS = parts.ICONS;
  if ('TAGS' in parts) TAGS = parts.TAGS;
  if ('SPAWNS' in parts) SPAWNS = parts.SPAWNS;
  if ('BGS' in parts) BGS = parts.BGS;
}

// ---------- player settings: saved in localStorage ----------
export const account = { ...DEFAULT_ACCOUNT, ...store.get('ttd.account', {}) };   // changed in place
export const loadouts = store.get('ttd.loadouts', {});                              // changed in place
export let team = store.get('ttd.team', [null, null, null, null, null]);
export function setTeam(t) { team = t; }
// Items the optimizer must never pick. Copper Pickaxe starts excluded: it's currently unobtainable.
export let excluded = store.get('ttd.excluded', ['Copper Pickaxe']);
export function setExcluded(list) { excluded = list; }
