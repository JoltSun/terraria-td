// Fantasy Team "brain": picks which tower fills which role slot.
// Pure — no DOM, no globals — so it can be unit-tested (tests/verify.mjs).

// a range band [min, max] (or null = any range) as a lookup key
export const bandKey = (band) => (band ? band.join(',') : 'none');

// keep only options worth buying: sorted by cost, each must beat every cheaper one
export function paretoOptions(options) {
  const out = []; let best = -Infinity;
  for (const o of [...options].sort((a, b) => a.cost - b.cost || b.dps - a.dps)) if (o.dps > best + 1e-9) { out.push(o); best = o.dps; }
  return out;
}
export const FX_OPT_SCORE = {
  dps: (o) => o.dps,
  efficiency: (o) => o.each * 1000 / Math.max(o.cost / o.placements, 1),   // free units count as costing 1 mana
  rng: (o) => o.rng * 1e6 + o.each,
  luck: (o) => o.dps * (o.luck ?? 1),
};
// Assign distinct units to slots. cands: [{ unit, byBand: { key: { b, options } } }]
// DP over units; state = (bitmask of filled slots, mana bucket). Budget only binds for Most DPS.
export function fxAssign(cands, bands, mode, budget) {
  const n = bands.length, full = 1 << n, useBudget = (mode === 'dps' || mode === 'luck') && budget > 0;
  const step = useBudget ? Math.max(1, budget / 500) : 1, B = useBudget ? Math.floor(budget / step) : 0;
  const W = B + 1, score = FX_OPT_SCORE[mode];
  const opts = cands.map((c) => bands.map((band) => {
    const all = c.byBand[bandKey(band)]?.options || [];
    if (!all.length) return [];
    if (useBudget) return mode === 'luck' ? all : paretoOptions(all);
    const pool = mode === 'dps' || mode === 'luck' ? all : all.filter((o) => o.placements === 1);
    return [pool.reduce((a, x) => (score(x) > score(a) ? x : a))];
  }));
  let dp = new Float64Array(full * W).fill(-Infinity); dp[0] = 0;
  const choice = [];
  cands.forEach((c, ui) => {
    const nd = dp.slice(), pick = new Map();
    for (let mask = 0; mask < full; mask++) for (let m = 0; m < W; m++) {
      const v = dp[mask * W + m]; if (v === -Infinity) continue;
      for (let s = 0; s < n; s++) {
        if (mask & (1 << s)) continue;
        for (const o of opts[ui][s]) {
          const w = useBudget ? Math.ceil(o.cost / step - 1e-9) : 0;
          if (m + w > B) continue;
          const at = (mask | (1 << s)) * W + m + w, nv = v + score(o);
          if (nv > nd[at] + 1e-9) { nd[at] = nv; pick.set(at, { s, o, from: mask * W + m }); }
        }
      }
    }
    choice.push(pick); dp = nd;
  });
  let best = -Infinity, at = 0;
  dp.forEach((v, i) => { if (v > best) { best = v; at = i; } });
  const out = Array(n).fill(null);
  for (let ui = cands.length - 1; ui >= 0 && at !== 0; ui--) {
    const p = choice[ui].get(at);
    if (p) { const c = cands[ui]; out[p.s] = { c: { b: c.byBand[bandKey(bands[p.s])].b }, o: p.o, band: bands[p.s] }; at = p.from; }
  }
  return out;
}
