// data.js — CSV loading + indexing. Works in the browser and in Node.

export function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => {
    const v = r[i] ?? '';
    return [h, v !== '' && !isNaN(v) ? Number(v) : v];
  })));
}

export function indexData({ units, upgrades, effects, reforges, enemies = [], weapons = [], armors = [], accessories = [], whips = [], achievements = [] }) {
  const byName = (arr) => Object.fromEntries(arr.map((r) => [r.name, r]));
  const ups = {};
  for (const r of upgrades) (ups[r.unit] ??= []).push(r);
  for (const k in ups) ups[k].sort((a, b) => a.tier - b.tier);
  const eff = {};
  for (const e of effects) (eff[e.item] ??= []).push(e);
  return {
    units: byName(units), upgrades: ups, effects: eff, reforges: byName(reforges),
    enemies, weapons, armors, accessories, whips, achievements,
  };
}

export async function loadAll(base = 'data/') {
  const get = async (f) => parseCSV(await (await fetch(base + f)).text());
  const [units, upgrades, effects, reforges, enemies, weapons, armors, accessories, whips] = await Promise.all(
    ['units', 'unit_upgrades', 'item_effects', 'reforges', 'enemies', 'weapons', 'armors', 'accessories', 'whips']
      .map((n) => get(n + '.csv')));
  // optional: older data/ folders may not have achievements.csv yet
  const achievements = await fetch(base + 'achievements.csv').then((r) => (r.ok ? r.text() : '')).then((t) => (t ? parseCSV(t) : [])).catch(() => []);
  return indexData({ units, upgrades, effects, reforges, enemies, weapons, armors, accessories, whips, achievements });
}
