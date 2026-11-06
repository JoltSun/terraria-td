// calc.js — the Terraria TD damage model.
// Every rule here was verified against in-game stat screens (see data/game_constants.csv).
// Pure functions only: no DOM. Used by app.js in the browser and by tests/verify.mjs in Node.

// ---------- level ----------
export function levelMult(level, canLevel = true) {
  if (!canLevel) return 1.02;                      // economy units are fixed at Lv 1
  const L = Math.max(1, Math.min(45, level));
  return 1 + 0.02 * Math.min(L, 25) + 0.01 * Math.max(L - 25, 0);  // additive per level
}

// The game truncates (not rounds) to 1 decimal on the stat screen.
export const trunc1 = (x) => Math.floor(x * 10 + 1e-9) / 10;
export const trunc2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

// ---------- account-wide buffs ----------
// Defaults = a maxed account like Jolt's. Every one of these MULTIPLIES (verified),
// except the flat ones (plantFiber, campfire) which are added after all multipliers.
export const DEFAULT_ACCOUNT = {
  seafood: 193,          // Seafood Dinner count (0–400), +0.05% DMG each
  act: true,             // Advanced Combat Technique, ×1.10 DMG
  bossSlayer: 5,         // achievement tiers 0–5, +1% DMG each (tiers add)
  packAPunch: 3,         // achievement tiers 0–4, +1% RNG each (tiers add)
  plantFiber: true,      // +1 RNG flat
  campfire: false,       // +1 Penetration flat
  // banners (owned + active)
  sandSlime: true,       // ×1.02 DMG
  stormHatchling: true,  // ×0.98 SPA
  wanderingEyeFish: true,// ×1.02 RNG
  desertScourge: true,   // +1 minimum damage (floor 1 → 2)
  spikedSlime: true,     // attacks ignore 1 DEF
  patchwerk: true,       // attacks ignore 1 DEF (assumed to stack with Spiked Slime)
  // situational banners — NOT shown on the stat screen, only apply in matching fights
  iceBat: true,          // +5% DMG at night
  undeadViking: true,    // +5% DMG vs bosses
  kingSlime: true,       // +10% DMG vs slimes
  eyeOfCthulhu: true,    // +10% DMG vs flying
  frozenZombie: true,    // +10% DMG vs zombies
  iceSlime: true,        // +10% DMG vs slowed
  cyanBeetle: true,      // +10% DMG vs full-health enemies
};

// ---------- item effects ----------
// effects: array of {stat, op, value}; op ∈ mult | add | pct | max
function collectGear(items, effectsByItem) {
  const g = { mult: {}, add: {}, pct: {}, max: {} };
  const names = [];
  for (const it of items) {
    if (!it) continue;
    names.push(it);
    for (const e of effectsByItem[it] || []) {
      if (e.op === 'mult') g.mult[e.stat] = (g.mult[e.stat] ?? 1) * e.value;
      else if (e.op === 'max') g.max[e.stat] = Math.min(g.max[e.stat] ?? Infinity, e.value);
      else g[e.op][e.stat] = (g[e.op][e.stat] ?? 0) + e.value;
    }
  }
  // set bonuses (only the ones that change DPS math)
  const has = (n) => names.includes(n);
  if (has('Pumpkin Helmet') && has('Pumpkin Breastplate') && has('Pumpkin Leggings'))
    g.critDmgBonus = 0.20;   // verified in-game 20% (board says 40%)
  return g;
}
const M = (g, s) => g.mult[s] ?? 1;
const A = (g, s) => g.add[s] ?? 0;
const P = (g, s) => g.pct[s] ?? 0;

// ---------- the build → final stats ----------
// build = { tier: row from unit_upgrades, unit: row from units, level, reforge: {DMG,SPA,RNG},
//           items: [names], account, whip: 0|1|2, fight: {night, boss, slime, flying, zombie, slowed, fullHp} }
export function computeStats(build, effectsByItem) {
  const { tier, unit, level = 45, reforge = { DMG: 1, SPA: 1, RNG: 1 }, items = [],
          account = DEFAULT_ACCOUNT, fight = {} } = build;
  const a = account, g = collectGear(items, effectsByItem);
  const lvl = levelMult(level, unit.can_level !== 'no');

  // Multipliers that the in-game stat screen includes
  const acctDmg = (1 + 0.0005 * a.seafood) * (a.act ? 1.10 : 1) * (a.sandSlime ? 1.02 : 1)
                * (1 + 0.01 * a.bossSlayer);
  // Situational ones (excluded from the stat screen — verified with Ice Bat / Viking toggles)
  let sit = 1;
  if (fight.night && a.iceBat) sit *= 1.05;
  if (fight.boss && a.undeadViking) sit *= 1.05;
  if (fight.slime && a.kingSlime) sit *= 1.10;
  if (fight.flying && a.eyeOfCthulhu) sit *= 1.10;
  if (fight.zombie && a.frozenZombie) sit *= 1.10;
  if (fight.slowed && a.iceSlime) sit *= 1.10;
  if (fight.fullHp && a.cyanBeetle) sit *= 1.10;

  const dmgMult = lvl * M(g, 'DMG') * reforge.DMG * acctDmg;
  const DMG_screen = tier.DMG * dmgMult + A(g, 'DMG');           // flat added LAST
  const DMG = tier.DMG * dmgMult * sit + A(g, 'DMG');

  const SPA = tier.SPA * M(g, 'SPA') * reforge.SPA * (a.stormHatchling ? 0.98 : 1) + A(g, 'SPA');

  let RNG = tier.RNG * M(g, 'RNG') * reforge.RNG * (1 + 0.01 * a.packAPunch)
          * (a.wanderingEyeFish ? 1.02 : 1) + A(g, 'RNG') + (a.plantFiber ? 1 : 0);
  if (g.max.RNG !== undefined) RNG = Math.min(RNG, g.max.RNG);
  RNG = Math.max(1, RNG);   // hard in-game floor, even after flat RNG-reducing gear

  let Pen = (tier.Penetration || 0) + A(g, 'Penetration') + (a.campfire ? 1 : 0);
  if (g.max.Penetration !== undefined) Pen = Math.min(Pen, g.max.Penetration);

  let Splash = tier.Splash ? tier.Splash * M(g, 'Splash') + A(g, 'Splash') : A(g, 'Splash');
  if (g.max.Splash !== undefined) Splash = Math.min(Splash, g.max.Splash);

  const chains = (tier.MaxChain || 0) + A(g, 'MaxChain');
  const preserve = Math.min((tier.Preserve || 0) + A(g, 'Preserve'), 1);   // additive, capped 100%

  return {
    DMG, DMG_screen, SPA, RNG, Pen, Splash,
    Globe: tier.Globe || 0,
    chains: chains > 0 ? Math.max(chains, 1) : 1,
    preserve: chains > 0 ? preserve : 0,
    pellets: tier.Pellets || 1,
    percent: tier.Percent || 0,
    confusion: tier.Confusion || 0,   // seconds of Confusion per hit (freezes non-boss enemies in place)
    critChance: P(g, 'Crit Chance') / 100,
    critMult: 2 + (g.critDmgBonus || 0),                         // crit dmg bonus ADDS to 2×
    doubleAttack: P(g, 'Double Attack') / 100,                   // chances ADD
    ignoreDef: (a.spikedSlime ? 1 : 0) + (a.patchwerk ? 1 : 0),
    defMult: Number(unit.def_mult) || 1,   // Zephyr Fish: each point of (remaining) DEF removes 5 damage
    floor: 1 + (a.desertScourge ? 1 : 0),
    luck: M(g, 'Luck'),
    retargetDelay: RETARGET_DELAY[unit.name] || 0,   // drop-luck multiplier; it only counts on enemies THIS unit kills (killing blow)
    placementCostMult: M(g, 'Placement Cost'),
    upgradeCostMult: M(g, 'Upgrade Cost'),
    dmgMult, lvl, acctDmg, situational: sit,
  };
}

// Stat-screen DPS (what the in-game bar shows): DEF 0, no whip, crit + double attack as expectations
export function screenDPS(s) {
  return s.DMG_screen / s.SPA * (1 + s.critChance * (s.critMult - 1)) * (1 + s.doubleAttack);
}

// ---------- real damage vs an enemy ----------
// enemy = { DEF, maxHP };  opts = { whip, targets, pelletsHit, whipCrits }
export function damagePerAttack(s, enemy, opts = {}) {
  const { whip = 0, targets = 1, pelletsHit = s.pellets, whipCrits = false, density = null, clump = 8,
          spawnCrowd = false, badLuck = 0, chainTargets = Infinity } = opts;
  // a chain bounces to the NEXT enemy in line — it never hits the same enemy twice, so it's capped by how many are there
  const chains = Math.max(1, Math.min(s.chains, chainTargets));
  // Bad Luck (Black Cat's 3s debuff): the enemy takes crits more often — adds to every tower's crit chance, cap 100%
  const cc = Math.min(1, s.critChance + badLuck);
  // Penetration / banner ignores are subtracted first, then the unit's defense multiplier applies
  const effDef = Math.max(enemy.DEF - s.Pen - s.ignoreDef, 0) * (s.defMult || 1);
  const hit = (base, crit) => {
    const raw = crit ? base * s.critMult + (whipCrits ? whip * s.critMult : whip) : base + whip;
    return Math.max(raw - effDef, s.floor);
  };
  const expected = (base) => (1 - cc) * hit(base, false) + cc * hit(base, true);

  let perTarget;
  if (s.pellets > 1) {
    // listed DMG assumes all pellets land; defense applies per pellet
    perTarget = expected(s.DMG / s.pellets) * Math.min(pelletsHit, s.pellets);
  } else if (chains > 1) {
    // chain k deals DMG × preserve^(k-1); defense per hit; chains hit different enemies
    perTarget = 0;
    for (let k = 0; k < chains; k++) perTarget += expected(s.DMG * Math.pow(s.preserve, k));
  } else {
    perTarget = expected(s.DMG);
  }
  // % max-HP damage: raw (no multipliers), ignores defense, capped at 100 per hit
  const pct = s.percent ? Math.min(s.percent / 100 * (enemy.maxHP || 0), 100) : 0;
  // How many enemies one AoE hit catches.
  //  - density given (enemies per splash-unit of lane): radius r covers ~2r of lane, which holds ~density·2r
  //    enemies — the target included, so no "+1". Floor 1 (the target), cap at the clump size.
  //    Fitted to in-game impact counts (Forest Master Blood Moon: Splash 2/4/8 ≈ 1.5/3/6). Globe uses RNG as r.
  //  - otherwise: the fixed `targets` count (Build panel's "Targets in AoE").
  let aoe = 1;
  if (s.Splash > 0 || s.Globe > 0) {
    const r = s.Globe > 0 ? s.RNG : s.Splash;
    // Spawn camping: enemies overlap around the portal, so even a small radius catches several.
    // Calibrated anchors: Splash 2 ≈ 3.5 targets, Splash 4 ≈ 5, Splash 8 ≈ 8.
    aoe = spawnCrowd ? Math.min(clump, 2 + 0.75 * r)
      : density != null ? Math.min(clump, density * 2 * r) : Math.max(1, targets);
    if (s.Globe > 0) aoe = Math.min(aoe, s.Globe);
    aoe = Math.max(1, aoe);
  }
  return (perTarget + pct) * aoe;
}

export function realDPS(s, enemy, opts) {
  const dps = damagePerAttack(s, enemy, opts) * (1 + s.doubleAttack) / s.SPA;
  // Lock-on units (Suspicious Eye) pause after each kill before shooting again:
  // one kill takes H/dps seconds plus the delay. Negligible on bosses, brutal on small mobs.
  const H = enemy.HP || 0;
  return s.retargetDelay > 0 && H > 0 ? H / (H / dps + s.retargetDelay) : dps;
}
// Seconds a lock-on unit waits after a kill before it can fire again (Jolt, in-game)
export const RETARGET_DELAY = { 'Suspicious Eye': 1 };

// ---------- cost ----------
export function totalCost(upgradeRows, tierIndex, s) {
  let cost = 0;
  for (const r of upgradeRows) {
    if (r.tier > tierIndex) break;
    cost += r.tier === 0 ? r.tier_cost * s.placementCostMult : r.tier_cost * s.upgradeCostMult;
  }
  return cost;
}
