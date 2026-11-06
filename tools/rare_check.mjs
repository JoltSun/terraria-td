import { readFileSync } from 'node:fs';
import { parseCSV } from '../data.js';
// Lists the items Fantasy Teams' "Realistic rarity" treats as one copy.  Run:  node tools/rare_check.mjs
// an item is "ultra-rare" when none of its sources is repeatable at a reasonable rate
export function isUltraRare(obtain) {
  const sources = String(obtain || '').split('|').map((s) => s.trim()).filter(Boolean);
  const pct = (s) => { const n = [...s.matchAll(/([\d.]+)\s*%/g)].map((m) => Number(m[1])); return n.length ? Math.max(...n) : null; };
  const repeatable = sources.some((s) => {
    if (/^(Crafting with|Buying from Market|A chance to be bought from Traveling Merchant)/i.test(s)) return true;
    if (/fished up/i.test(s)) return !/(extremely|very) rare/i.test(s);
    if (/^(A (rare |very rare )?chance to drop from|Dropping from)/i.test(s)) { const p = pct(s); return p !== null && p >= 1; }
    return false;   // milestones, wave/premium rewards, badges, codes, unit crafting, patch notes
  });
  return sources.length > 0 && !repeatable;
}
const all = ['weapons','armors','accessories'].flatMap((f) => parseCSV(readFileSync(new URL(`../data/${f}.csv`, import.meta.url),'utf8')));
console.log(all.filter((r) => isUltraRare(r.obtain)).map((r) => r.name).join(', '));
