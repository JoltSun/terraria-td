// optimizer.js — searches gear combinations for the best loadout.
// Pure logic: the caller supplies `evaluate(loadout) -> { dps, rng }`.
//
// Strategy: local search (change one slot at a time, keep any improvement) from many random
// starting loadouts, plus the user's current loadout as a start. Every distinct loadout seen
// is kept, so we can return the top few different answers, not just one.

export const MODES = {
  dps: { label: 'Most DPS', score: (r) => r.dps },
  rng: { label: 'Most range', score: (r) => r.rng * 1e6 + r.dps },        // range first, DPS breaks ties
  balanced: { label: 'Balanced (DPS × RNG)', score: (r) => r.dps * r.rng },  // +10% DPS ≈ +10% RNG
  efficiency: { label: 'Most DPS per mana', score: (r) => r.dps / r.cost },   // rewards cost cutters (Ammo Box, Flinx Fur Coat)
  // luck only applies to enemies the unit itself kills, and its share of kills tracks its DPS: score lucky kills
  luck: { label: 'Most luck (Luck × DPS)', score: (r) => r.dps * (r.luck ?? 1) },
};

// slots: [{ key, options: [names incl. ''] , group?: 'acc' }]
// rules: { conflicts: [[a, b], ...] }  (items that can't be equipped together)
export function optimize({ slots, start, evaluate, mode = 'dps', scoreFn = null, minRng = 0, restarts = 120, rules = {}, top = 5, exhaustiveLimit = 150000 }) {
  const score = scoreFn || MODES[mode].score;   // callers may pass their own scoring
  const seen = new Map();          // key -> { loadout, dps, rng, score }
  const conflicts = rules.conflicts || [];

  const valid = (L) => {
    const acc = slots.filter((s) => s.group === 'acc').map((s) => L[s.key]).filter(Boolean);
    if (new Set(acc).size !== acc.length) return false;                // one of each accessory
    const all = new Set(Object.values(L).filter(Boolean));
    return !conflicts.some(([a, b]) => all.has(a) && all.has(b));
  };
  const keyOf = (L) => {
    const acc = slots.filter((s) => s.group === 'acc').map((s) => L[s.key] || '').sort();
    return slots.filter((s) => s.group !== 'acc').map((s) => L[s.key] || '').join('|') + '#' + acc.join('|');
  };
  const judge = (L) => {
    const k = keyOf(L);
    if (seen.has(k)) return seen.get(k);
    const r = evaluate(L);
    const ok = r.rng + 1e-9 >= minRng;
    const res = { loadout: { ...L }, dps: r.dps, rng: r.rng, cost: r.cost, luck: r.luck ?? 1, ok, score: ok ? score(r) : -Infinity + r.rng };
    seen.set(k, res);
    return res;
  };
  const better = (a, b) => (a.ok !== b.ok ? a.ok : a.ok ? a.score > b.score + 1e-9 : a.rng > b.rng + 1e-9);

  const climb = (L) => {
    let cur = judge(L);
    for (let pass = 0; pass < 12; pass++) {
      let improved = false;
      for (const s of slots) {
        for (const opt of s.options) {
          if (opt === cur.loadout[s.key]) continue;
          const T = { ...cur.loadout, [s.key]: opt };
          if (!valid(T)) continue;
          const r = judge(T);
          if (better(r, cur)) { cur = r; improved = true; }
        }
      }
      if (!improved) break;
    }
    return cur;
  };

  const randomLoadout = () => {
    for (let tries = 0; tries < 50; tries++) {
      const L = {};
      for (const s of slots) L[s.key] = s.options[Math.floor(Math.random() * s.options.length)];
      if (valid(L)) return L;
    }
    return { ...start };
  };

  climb(valid(start) ? start : randomLoadout());
  for (let i = 0; i < restarts; i++) climb(randomLoadout());

  // Final pass: with the best weapon/armor fixed, try EVERY accessory combination (if that's a sane number),
  // so the accessory picks are guaranteed optimal rather than just "very likely".
  const accSlots = slots.filter((s) => s.group === 'acc');
  if (accSlots.length) {
    const pool = accSlots[0].options.filter(Boolean);
    const k = accSlots.length;
    let combos = 1; for (let i = 0; i < k; i++) combos = combos * (pool.length + 1 - i) / (i + 1);
    if (combos <= exhaustiveLimit) {
      const bestNow = [...seen.values()].reduce((a, b) => (better(b, a) ? b : a));
      const fixed = { ...bestNow.loadout };
      const pick = (from, chosen) => {
        if (chosen.length === k) {
          const L = { ...fixed }; accSlots.forEach((sl, i) => { L[sl.key] = chosen[i] || ''; });
          if (valid(L)) judge(L);
          return;
        }
        for (let i = from; i < pool.length; i++) pick(i + 1, [...chosen, pool[i]]);
        if (chosen.length < k) pick(pool.length, [...chosen, '']);   // allow empty slots
      };
      pick(0, []);
    }
  }

  const ranked = [...seen.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  return { results: ranked.slice(0, top), evaluated: seen.size, current: judge(start) };
}
