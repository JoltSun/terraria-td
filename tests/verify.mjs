// Checks the model against real in-game stat screens.  Run:  node tests/verify.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeStats, screenDPS, damagePerAttack, realDPS, trunc1, trunc2, DEFAULT_ACCOUNT } from '../calc.js';
import { parseCSV, indexData } from '../data.js';
import { fxAssign, paretoOptions, bandKey } from '../fantasy-core.js';
import * as S from '../state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => parseCSV(readFileSync(join(root, 'data', f), 'utf8'));
const D = indexData({
  units: load('units.csv'), upgrades: load('unit_upgrades.csv'), effects: load('item_effects.csv'),
  reforges: load('reforges.csv'),
});

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = Math.abs(got - want) < 1e-6;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${label}: model ${got} vs in-game ${want}`);
}
function build(unit, tier, items, extra = {}) {
  return computeStats({
    unit: D.units[unit], tier: D.upgrades[unit][tier], level: 45,
    reforge: D.reforges.Legendary, items, account: { ...DEFAULT_ACCOUNT, ...(extra.account || {}) },
  }, D.effects);
}

// Slime Prince — Storm Mask, Gi, Boreal Greaves, Copper Shortsword, Sandstorm, Pufferfish, Blizzard
const sp = ['Ancient Storm Mask', 'Gi', 'Boreal Wood Greaves', 'Copper Shortsword',
            'Sandstorm in a Bottle', 'Balloon Pufferfish', 'Blizzard in a Bottle'];
[[18.3, 1.95, 12.5, 12.3], [25.6, 1.62, 14.8, 20.8], [40.2, 1.3, 18.3, 40.8], [80.5, 3.25, 14.8, 32.7]]
  .forEach(([dmg, spa, rng, dps], t) => {
    const s = build('Slime Prince', t, sp);
    check(`Slime Prince t${t} DMG`, trunc1(s.DMG_screen), dmg);
    check(`Slime Prince t${t} SPA`, trunc2(s.SPA), spa);
    check(`Slime Prince t${t} RNG`, trunc1(s.RNG), rng);
    check(`Slime Prince t${t} DPS`, trunc1(screenDPS(s)), dps);
  });

// Star Merchant (Lv 1 fixed) — Storm Mask, Gi, Greaves, Flurry, Dunerider, Shield of Cthulhu, Arkhalis
const sm = ['Ancient Storm Mask', 'Gi', 'Boreal Wood Greaves', 'Flurry Boots', 'Dunerider Boots',
            'Shield of Cthulhu', 'Arkhalis'];
[187, 332.4, 415.5, 623.3, 1454.4].forEach((dmg, t) =>
  check(`Star Merchant t${t} DMG`, trunc1(build('Star Merchant', t, sm).DMG_screen), dmg));
[183.3, 325.9, 407.4, 611.1, 1425.9].forEach((dmg, t) =>
  check(`Star Merchant t${t} DMG (Sand Slime off)`,
        trunc1(build('Star Merchant', t, sm, { account: { sandSlime: false } }).DMG_screen), dmg));

// Dye Trader — Storm Mask, Gi, Greaves, Sandstorm, Flurry, Falcon Blade (+/- Encumbering Stone)
const dt = ['Ancient Storm Mask', 'Gi', 'Boreal Wood Greaves', 'Sandstorm in a Bottle', 'Flurry Boots', 'Falcon Blade'];
[[22.9, 0.52, 48.5], [22.9, 0.41, 60.7], [22.9, 0.26, 97.1], [29.6, 0.26, 125.3]].forEach(([dmg, spa, dps], t) => {
  const s = build('Dye Trader', t, dt);
  check(`Dye Trader t${t} DMG`, trunc1(s.DMG_screen), dmg);
  check(`Dye Trader t${t} SPA`, trunc2(s.SPA), spa);
  check(`Dye Trader t${t} DPS`, trunc1(screenDPS(s)), dps);
});
[[25.3, 1.52, 18.3], [25.3, 1.41, 19.7], [25.3, 1.26, 22.1], [32.8, 1.26, 28.6]].forEach(([dmg, spa, dps], t) => {
  const s = build('Dye Trader', t, [...dt, 'Encumbering Stone']);
  check(`Dye Trader + Encumbering t${t} DMG`, trunc1(s.DMG_screen), dmg);
  check(`Dye Trader + Encumbering t${t} SPA`, trunc2(s.SPA), spa);
  check(`Dye Trader + Encumbering t${t} DPS`, trunc1(screenDPS(s)), dps);
});

// Snow Launcher t4 — Ice Blade, Viking Helmet, Flinx Fur Coat, Boreal Greaves,
// Shield of Cthulhu, Zephyr's Grip, Black Counterweight, Flying Carpet (pins Zephyr's Grip at +2 RNG)
{
  const s = build('Snow Launcher', 4, ['Ice Blade', 'Viking Helmet', 'Flinx Fur Coat', 'Boreal Wood Greaves',
                                       'Shield of Cthulhu', "Zephyr's Grip", 'Black Counterweight', 'Flying Carpet']);
  check('Snow Launcher t4 DMG', trunc1(s.DMG_screen), 55.4);
  check('Snow Launcher t4 SPA', trunc2(s.SPA), 0.35);
  check('Snow Launcher t4 RNG', trunc1(s.RNG), 25.2);
  check('Snow Launcher t4 DPS', trunc1(screenDPS(s)), 158.2);
}

// Suspicious Eye t0–t4 — Grave Buster, Ancient Storm Mask, Gi, Boreal Greaves, Shield of Cthulhu, Ice Skates, Flurry Boots
// (in-game gear bonuses screen: 1.57x DMG (+2), 0.51x SPA, 1.12x RNG (−3), +1 Penetration)
const se = ['Grave Buster', 'Ancient Storm Mask', 'Gi', 'Boreal Wood Greaves', 'Shield of Cthulhu', 'Ice Skates', 'Flurry Boots'];
[[5.4, 0.1, 20.6, 54.1], [7.1, 0.1, 26.5, 71.3], [10.6, 0.1, 26.5, 105.7], [15.8, 0.08, 26.5, 196.5], [19.3, 0.06, 32.4, 319.3]]
  .forEach(([dmg, spa, rng, dps], t) => {
    const s = build('Suspicious Eye', t, se);
    check(`Suspicious Eye t${t} DMG`, trunc1(s.DMG_screen), dmg);
    check(`Suspicious Eye t${t} SPA`, trunc2(s.SPA), spa);
    check(`Suspicious Eye t${t} RNG`, trunc1(s.RNG), rng);
    check(`Suspicious Eye t${t} DPS`, trunc1(screenDPS(s)), dps);
  });

// Vampire Frog t0–t3 — Ice Blade, Viking Helmet, Flinx Fur Coat, Boreal Greaves,
// Platinum Crown, Zephyr's Grip, Shield of Cthulhu, Balloon Pufferfish
// (in-game gear bonuses screen: 1.7x DMG, 0.7x SPA, 1.21x RNG (+8), +1 Penetration, +10% Crit)
const vf = ['Ice Blade', 'Viking Helmet', 'Flinx Fur Coat', 'Boreal Wood Greaves',
            'Platinum Crown', "Zephyr's Grip", 'Shield of Cthulhu', 'Balloon Pufferfish'];
[[44.8, 2.05, 18.8, 23.9], [93.4, 1.85, 18.8, 55.4], [149.5, 1.37, 18.8, 119.8], [149.5, 1.09, 23.2, 149.7]]
  .forEach(([dmg, spa, rng, dps], t) => {
    const s = build('Vampire Frog', t, vf);
    check(`Vampire Frog t${t} DMG`, trunc1(s.DMG_screen), dmg);
    check(`Vampire Frog t${t} SPA`, trunc2(s.SPA), spa);
    check(`Vampire Frog t${t} RNG`, trunc1(s.RNG), rng);
    check(`Vampire Frog t${t} DPS`, trunc1(screenDPS(s)), dps);
  });

// Zoologist — RNG-reducing gear cannot push the reverse-path summon below the in-game floor.
check('Zoologist minimum RNG', build('Zoologist', 3, ['Mandible Blade', 'Ice Skates']).RNG, 1);

// ---------- damagePerAttack: real damage after defense, chains, splash, pellets, crits ----------
// Synthetic stat blocks (not game data) so each rule is isolated.
const base = { DMG: 100, SPA: 1, pellets: 1, chains: 1, preserve: 0, Splash: 0, Globe: 0, RNG: 10,
               Pen: 0, ignoreDef: 0, defMult: 1, floor: 1, critChance: 0, critMult: 2, percent: 0 };
const dpa = (over, enemy = {}, opts = {}) => damagePerAttack({ ...base, ...over }, { DEF: 0, maxHP: 0, ...enemy }, opts);

// defense
check('DEF subtracts flat', dpa({}, { DEF: 30 }), 70);
check('DEF floors at 1', dpa({}, { DEF: 500 }), 1);
check('Penetration reduces DEF', dpa({ Pen: 10 }, { DEF: 30 }), 80);
// crits: expected value
check('50% crit, x2 → 150', dpa({ critChance: 0.5 }), 150);
check('Bad Luck adds crit chance', dpa({ critChance: 0.5 }, {}, { badLuck: 0.5 }), 200);
// chains (Max Chain 4, Preserve 50%): capped by distinct enemies, never revisits one
const ch = { chains: 4, preserve: 0.5 };
check('Chain, 1 enemy → first hit only', dpa(ch, {}, { targets: 1 }), 100);
check('Chain, 2 enemies → 2 hits', dpa(ch, {}, { targets: 2 }), 150);
check('Chain, 3 enemies → 3 hits', dpa(ch, {}, { targets: 3 }), 175);
check('Chain, 10 enemies → Max Chain', dpa(ch, {}, { targets: 10 }), 187.5);
check('Chain default (no opts) → 1 hit', dpa(ch), 100);
check('Chain, explicit chainTargets wins', dpa(ch, {}, { targets: 1, chainTargets: 3 }), 175);
check('Chain applies DEF per hit', dpa(ch, { DEF: 20 }, { targets: 3 }), 80 + 30 + 5);
// pellets: listed DMG assumes all land; DEF per pellet
check('Pellets, all 3 land', dpa({ pellets: 3 }, {}, { pelletsHit: 3 }), 100);
check('Pellets, 1 of 3 lands', dpa({ pellets: 3 }, {}, { pelletsHit: 1 }), 100 / 3);
check('Pellets, DEF per pellet', dpa({ pellets: 4 }, { DEF: 10 }, { pelletsHit: 4 }), 60);
// splash: manual count, ordinary towers ignore it, calibrated densities
check('Ordinary tower ignores enemy count', dpa({}, {}, { targets: 5 }), 100);
check('Splash, manual 3 targets', dpa({ Splash: 2 }, {}, { targets: 3 }), 300);
check('Splash 4, medium density 0.375 → 3', dpa({ Splash: 4 }, {}, { density: 0.375 }), 300);
check('Splash 8, medium density → 6', dpa({ Splash: 8 }, {}, { density: 0.375 }), 600);
check('Splash 2, light density → floor 1', dpa({ Splash: 2 }, {}, { density: 0.18 }), 100);
check('Splash capped by clump', dpa({ Splash: 8 }, {}, { density: 0.375, clump: 4 }), 400);
check('Spawn camping, Splash 2 → 3.5', dpa({ Splash: 2 }, {}, { spawnCrowd: true }), 350);
// % max-HP damage: ignores DEF, capped at 100
check('% max-HP adds, capped 100', dpa({ percent: 10 }, { maxHP: 5000 }), 200);

// Lock-on (Suspicious Eye) is a bossing tower: scored with whip + DEF + crits, no per-kill pause
check('Lock-on: no kill pause vs small HP', realDPS({ ...base, doubleAttack: 0, retargetDelay: 1 }, { DEF: 0, maxHP: 100, HP: 100 }, {}), 100);
check('Lock-on: whip and DEF still apply', realDPS({ ...base, doubleAttack: 0, retargetDelay: 1 }, { DEF: 20, maxHP: 100, HP: 100 }, { whip: 5 }), 85);

// ---------- Fantasy Team brain: fxAssign (DP over filled slots × mana budget) ----------
// synthetic towers: opt(dps, cost) is one tier/placement choice
const opt = (dps, cost, extra = {}) => ({ dps, each: dps, cost, placements: 1, rng: 10, tier: 0, ...extra });
const cand = (unit, byBandOpts) => ({ unit, byBand: Object.fromEntries(Object.entries(byBandOpts)
  .map(([k, options]) => [k, { b: { unit }, options }])) });
const ANY = [null, null];                        // two slots, any range
const team = (out) => out.map((x) => x?.c.b.unit ?? null);
const total = (out, k) => out.reduce((t, x) => t + (x ? x.o[k] : 0), 0);

// distinct units: the best tower can only fill ONE slot
{
  const out = fxAssign([cand('Ace', { none: [opt(500, 100)] }), cand('Bee', { none: [opt(200, 100)] })], ANY, 'dps', 0);
  check('fxAssign: no unit used twice', new Set(team(out)).size, 2);
  check('fxAssign: both slots filled', team(out).filter(Boolean).length, 2);
}
// picks the best combination, not greedily the best single tower
{
  const out = fxAssign([cand('A', { none: [opt(300, 100)] }), cand('B', { none: [opt(250, 100)] }),
                        cand('C', { none: [opt(100, 100)] })], ANY, 'dps', 0);
  check('fxAssign: best two of three (total DPS)', total(out, 'dps'), 550);
}
// mana budget binds: the expensive star loses to two cheaper towers that fit
{
  // Star+Mid would be 1100 DPS but costs 1200 > 1000; Star alone (700) < Mid+Mid (800)
  const cands = [cand('Star', { none: [opt(700, 800)] }), cand('Mid1', { none: [opt(400, 400)] }),
                 cand('Mid2', { none: [opt(400, 400)] })];
  const out = fxAssign(cands, ANY, 'dps', 1000);
  check('fxAssign: total cost within budget', total(out, 'cost') <= 1000 ? 1 : 0, 1);
  check('fxAssign: best DPS under budget', total(out, 'dps'), 800);
  // 3 slots: with spare slots an over-budget pick could alias into a valid DP cell, so the guard must hold
  const out3 = fxAssign(cands, [null, null, null], 'dps', 1000);
  check('fxAssign: budget holds with spare slots (cost)', total(out3, 'cost') <= 1000 ? 1 : 0, 1);
  check('fxAssign: budget holds with spare slots (DPS)', total(out3, 'dps'), 800);
  check('fxAssign: budget 0 = unlimited', total(fxAssign(cands, ANY, 'dps', 0), 'dps'), 1100);
}
// range bands: a tower with no option for a band can't fill that slot
{
  const bands = [[0, 10], [20, null]];
  const out = fxAssign([cand('Short', { [bandKey([0, 10])]: [opt(300, 100)] })], bands, 'dps', 0);
  check('fxAssign: tower fills only its band', team(out)[0] === 'Short' && team(out)[1] === null ? 1 : 0, 1);
}
// efficiency mode ignores the budget and only considers single placements
{
  const out = fxAssign([cand('E', { none: [opt(100, 10), opt(400, 400, { placements: 3 })] })], [null], 'efficiency', 50);
  check('fxAssign: efficiency uses 1-placement option', out[0].o.placements, 1);
}
// paretoOptions keeps only options that beat every cheaper one
check('paretoOptions: drops dominated', paretoOptions([opt(100, 50), opt(90, 80), opt(200, 120)]).length, 2);
check('bandKey: null band', bandKey(null) === 'none' ? 1 : 0, 1);

// ---------- state.js: shared state seen live by every module ----------
// (Node has no localStorage, so this also checks the defaults when nothing is saved.)
check('state: default team is 5 empty slots', S.team.length === 5 && S.team.every((t) => t === null) ? 1 : 0, 1);
check('state: Copper Pickaxe excluded by default', S.excluded.includes('Copper Pickaxe') ? 1 : 0, 1);
S.setTeam([{ build: { unit: 'Guide' } }, null, null, null, null]);
check('state: setTeam is seen by importers', S.team[0]?.build.unit === 'Guide' ? 1 : 0, 1);
S.setExcluded(['Ice Skates']);
check('state: setExcluded is seen by importers', S.excluded.join() === 'Ice Skates' ? 1 : 0, 1);
S.setData({ TAGS: { 'Demon Eye': { time: 'night' } } });
check('state: setData updates only what it is given', S.TAGS['Demon Eye'] && S.D === null ? 1 : 0, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
