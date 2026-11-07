import { loadAll, parseCSV } from './data.js';
import { optimize, MODES } from './optimizer.js';
import { computeStats, screenDPS, realDPS, damagePerAttack, totalCost, trunc1, trunc2, DEFAULT_ACCOUNT } from './calc.js';
import { bandKey, FX_OPT_SCORE, fxAssign } from './fantasy-core.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let D, ICONS = {}, TAGS = {}, SPAWNS = [], BGS = {}, account = { ...DEFAULT_ACCOUNT, ...store.get('ttd.account', {}) };
let team = store.get('ttd.team', [null, null, null, null, null]);
let loadouts = store.get('ttd.loadouts', {});
let repairedTeamDuplicates = [];
// Items the optimizer must never pick. Copper Pickaxe starts excluded: it's currently unobtainable.
let excluded = store.get('ttd.excluded', ['Copper Pickaxe']);
// Items you can only own one of (badge rewards): Fantasy Teams gives each to at most one tower
// Game rule: only one of these can exist per account, so at most one tower may wear each (always enforced)
const ACCOUNT_UNIQUE = ['Copper Shortsword', 'Copper Pickaxe', 'Platinum Crown', 'Sand Gun', 'Grave Buster', 'Band of Regeneration'];
// (Items you don't own at all go in the "Items I don't own" list instead.)
// "Realistic rarity" (Fantasy Teams toggle): items with no repeatable source are treated as one copy too.
// Repeatable = crafting, Market / Traveling Merchant, a drop of ≥ 1%, or normal fishing. One-time rewards
// (milestones, wave/premium rewards, badges), sub-1% drops and "extremely/very rare" fishing don't count.
function isUltraRare(obtain) {
  const sources = String(obtain || '').split('|').map((s) => s.trim()).filter(Boolean);
  const pct = (s) => { const n = [...s.matchAll(/([\d.]+)\s*%/g)].map((m) => Number(m[1])); return n.length ? Math.max(...n) : null; };
  const repeatable = sources.some((s) => {
    if (/^(Crafting with|Buying from Market|A chance to be bought from Traveling Merchant)/i.test(s)) return true;
    if (/fished up/i.test(s)) return !/(extremely|very) rare/i.test(s);
    if (/^(A (rare |very rare )?chance to drop from|Dropping from)/i.test(s)) { const p = pct(s); return p !== null && p >= 1; }
    return false;
  });
  return sources.length > 0 && !repeatable;
}
let RARE_ITEMS = null;
const rareItems = () => (RARE_ITEMS ??= [...D.weapons, ...D.armors, ...D.accessories]
  .filter((r) => isUltraRare(r.obtain) && !ACCOUNT_UNIQUE.includes(r.name)).map((r) => r.name));
const realisticRarity = () => !!$('fxRealistic')?.checked;
// Realistic copy counts (set by Jolt from play experience). These override the automatic ultra-rare rule:
// listed items use this count (Infinity = farmable enough to be unlimited); other ultra-rare items get 1.
const REALISTIC_COPIES = {
  // 2 guaranteed (Grand Thunder Bird bestiary milestone + Desert Endless wave 60), then only a 1/33 Treasure Bag grind
  'Ancient Storm Mask': 2,
  'Ice Daggerfish': 2, 'Arkhalis': 1, 'Eyebrella': 1, 'Frog Leg': 3, 'Bat Hook': 3, 'Balloon Pufferfish': 3,
  // mob drops pile up with normal play: effectively unlimited
  'Zombie Arm': Infinity, 'Storm Spear': Infinity, 'Thunder Zapper': Infinity,
  'Ice Boomerang': Infinity, 'Viking Helmet': Infinity, 'Money Trough': Infinity,
};
// how many towers may wear this item at once (Infinity = unlimited)
function copyLimit(n) {
  if (ACCOUNT_UNIQUE.includes(n)) return 1;                       // game rule: always
  if (!realisticRarity()) return Infinity;
  if (n in REALISTIC_COPIES) return REALISTIC_COPIES[n];
  return rareItems().includes(n) ? 1 : Infinity;
}
const limitedItems = () => [...new Set([...ACCOUNT_UNIQUE,
  ...(realisticRarity() ? [...rareItems(), ...Object.keys(REALISTIC_COPIES)] : [])])].filter((n) => copyLimit(n) < Infinity);
const isOneCopy = (n) => copyLimit(n) < Infinity;

// [key, label, icon category, icon name] — banners use their enemy's sprite
const ACCT_CHECKS = [
  ['act', 'Advanced Combat Techniques (+10% DMG)', 'consumables', 'Advanced Combat Technique'],
  ['plantFiber', 'Plant Fiber Guide (+1 RNG)', 'consumables', 'Plant Fiber Guide'],
  ['campfire', 'Campfire (+1 Penetration)', 'consumables', 'Campfire'],
];

function opts(sel, names, blank) {
  sel.innerHTML = (blank ? `<option value="">${blank}</option>` : '') +
    names.map((n) => `<option value="${n}">${n}</option>`).join('');
}

const reforgeIconPath = (name = 'None') => {
  const file = name === 'None' ? 'NoReforge' : name;
  return `icons/hammers/${file}HammerIcon.png`;
};
const reforgeHammer = (name = 'None') =>
  `<img class="reforgeHammer" src="${encodeURI(reforgeIconPath(name))}" alt="${name} reforge" title="${name} reforge">`;

const TOWER_CARD_BACKGROUNDS = {
  'Slime Staff': 'backgrounds/Forest_background_2.webp',
  'Finch Staff': 'backgrounds/Forest_background_16.webp',
  'Guide': 'backgrounds/Forest_background_2.webp',
  'Volt Bunny': 'backgrounds/Forest_background_16.webp',
  'Flinx': 'backgrounds/Snow_biome_background_6.webp',
  'Desert Acolyte': 'backgrounds/Desert_background_4.webp',
  'Zoologist': 'backgrounds/forest_1.png',
  'Painter': 'backgrounds/forest_1.png',
  'Dye Trader': 'backgrounds/forest_2.gif',
  'Slime Prince': 'backgrounds/Forest_background_2.webp',
  'Chester': 'backgrounds/snow_1.png',
  'Zephyr Fish': 'backgrounds/Ocean_background_2.webp',
  'Digtoise': 'backgrounds/desert_2.png',
  'Demolitionist': 'backgrounds/Cavern_background_9.webp',
  'Golfer': 'backgrounds/Desert_background_3.png',
  'Baby Ghost Bell': 'backgrounds/Desert_background_4.webp',
  'Storm Cloud': 'backgrounds/desert_1.gif',
  'Houndius Shootius': 'backgrounds/Snow_biome_background_10.webp',
  'Vampire Frog': 'backgrounds/bloodmoon2.webp',
  'Bast Statue': 'backgrounds/desert_1.gif',
  'Snow Launcher': 'backgrounds/snow_2.png',
  'Suspicious Eye': 'backgrounds/Forest_background_2_NIGHT.webp',
  'Merchant': 'backgrounds/forest_1.png',
  'Star Merchant': 'backgrounds/Forest_background_16_NIGHT.webp',
  'Black Cat': 'backgrounds/pumpkinguys.webp',
  'Squashling': 'backgrounds/pumpkinguys.webp',
  'Baby Dinosaur': 'backgrounds/Desert_background_3.png',
  'Tiny Deerclops': 'backgrounds/Snow_biome_background_6.webp',
};

function towerCardVisual(g, level) {
  const itemIcon = (cat, name) => ICONS[cat]?.[name]
    ? `<img src="${encodeURI(ICONS[cat][name])}" alt="" title="${name}">` : '';
  const portraitPath = ICONS.units?.[g.unit];
  const portrait = portraitPath
    ? `<img class="teamPortraitImg" src="${encodeURI(portraitPath)}" alt="${g.unit}">`
    : '<span class="teamPortraitFallback" aria-hidden="true">?</span>';
  const gear = [
    ['weapons', g.weapon, 'Weapon'],
    ['armors', g.helmet, 'Helmet'],
    ['armors', g.chest, 'Chest'],
    ['armors', g.boots, 'Boots'],
    ...g.acc.map((a, n) => ['accessories', a, `Accessory ${n + 1}`]),
  ].map(([cat, name, label]) => `<span class="teamGearSlot${name ? '' : ' empty'}" title="${name || `${label}: empty`}">
    ${name ? itemIcon(cat, name) : ''}
  </span>`).join('');
  return `<div class="teamCardVisual">
    <div class="teamTowerIdentity">
      <div class="teamPortrait">${portrait}</div>
      <div class="teamTowerName">${g.unit}</div>
      <div class="teamTowerLevel">Lv. ${level}</div>
    </div>
    <div class="teamLoadout" aria-label="Equipped gear and reforge">
      <div class="teamGearGrid">${gear}</div>
      <div class="teamHammer">${reforgeHammer(g.reforge)}</div>
    </div>
  </div>`;
}
// units missing from TOWER_CARD_BACKGROUNDS get no backdrop (plain panel) instead of url('undefined')
const towerCardStyle = (unit) => (TOWER_CARD_BACKGROUNDS[unit] ? `--tower-card-bg:url('${encodeURI(TOWER_CARD_BACKGROUNDS[unit])}')` : '');

function updateReforgeShowcase(name = $('reforge').value || 'None') {
  const img = $('reforgePreview');
  if (!img) return;
  img.src = encodeURI(reforgeIconPath(name));
  img.alt = `${name} reforge`;
  img.title = `${name} reforge`;
};

async function init() {
  try { D = await loadAll(); }
  catch (e) { $('status').textContent = 'Could not load data/ — open this through Live Server or python -m http.server'; $('status').hidden = false; return; }
  const repaired = uniqueTeamSlots(team);
  team = repaired.team; repairedTeamDuplicates = repaired.removed;
  if (repairedTeamDuplicates.length) store.set('ttd.team', team);
  try { TAGS = Object.fromEntries(parseCSV(await (await fetch('data/enemy_tags.csv')).text()).map((r) => [r.name, r])); } catch { TAGS = {}; }
  try { SPAWNS = parseCSV(await (await fetch('data/act_spawns.csv')).text()); } catch { SPAWNS = []; }
  try { BGS = await (await fetch('backgrounds/manifest.json')).json(); } catch { BGS = {}; }
  try { ICONS = await (await fetch('icons/manifest.json')).json(); } catch { ICONS = {}; }
  headingIcons();
  buildNav();
  window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(render, 150); });

  opts($('unit'), Object.keys(D.units).sort());
  opts($('reforge'), Object.keys(D.reforges));
  $('reforge').value = 'Legendary';
  opts($('weapon'), D.weapons.map((w) => w.name).sort(), '— none —');
  const armorBy = (part) => D.armors.filter((a) => a.group.endsWith(part)).map((a) => a.name).sort();
  opts($('helmet'), armorBy('Helmet'), '— none —');
  opts($('chest'), armorBy('Chestplate'), '— none —');
  opts($('boots'), armorBy('Boots'), '— none —');
  opts($('enemy'), D.enemies.map((e) => e.name), '— custom —');
  const acts = [...new Set(SPAWNS.map((r) => `${r.biome} Act ${r.act}`))];
  opts($('act'), acts, '— pick an act —');
  const lastAct = store.get('ttd.act', null);
  if (lastAct) { $('act').value = lastAct.act || ''; $('diff').value = lastAct.diff || 'Classic'; }

  // account panel
  $('acctChecks').innerHTML = ACCT_CHECKS.map(([k, l, cat, name]) => {
    const path = ICONS[cat]?.[name];
    return `<label class="acct"><input type="checkbox" data-acct="${k}">${path ? `<img src="${encodeURI(path)}" alt="">` : '<span class="noimg"></span>'}<span>${l}</span></label>`;
  }).join('');
  document.querySelectorAll('[data-acct]').forEach((c) => { c.checked = !!account[c.dataset.acct]; });
  account.seafood = clampSeafood(account.seafood);   // fix any old out-of-range saved value
  $('seafood').value = account.seafood;
  syncSeafood();
  $('achList').onclick = onAchClick;
  renderBanners();
  $('bannerGrid').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-banner]'); if (!t) return;
    setBanner(t.dataset.banner, !bannerOwned(t.dataset.banner)); renderBanners(); render();
  });
  $('bannerSearch').addEventListener('input', renderBanners);
  $('bannerAll').onclick = () => { for (const r of D.banners) setBanner(bannerName(r), true); renderBanners(); render(); };
  $('bannerNone').onclick = () => { for (const r of D.banners) setBanner(bannerName(r), false); renderBanners(); render(); };
  $('fxRun').onclick = runFantasy;
  renderComparePickers();
  // chart hover: crosshair + tooltip (redraws from the cached lines, no recalculation)
  $('chart').addEventListener('mousemove', (ev) => {
    const C = chartCache; if (!C || C.empty) return;
    const r = $('chart').getBoundingClientRect(), x = ev.clientX - r.left, pl = 62, pw = C.W - 62 - 22;
    chartHover = x >= pl && x <= pl + pw ? Math.round(C.minDef + ((x - pl) / pw) * (C.capDef - C.minDef)) : null; paintChart();
  });
  $('chart').addEventListener('mouseleave', () => { chartHover = null; paintChart(); });
  $('cmpTierPick').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tier]'); if (!b) return;
    cmpTier = b.dataset.tier; store.set('ttd.cmpTier', cmpTier); runCompare();
  });
  $('cmpGearPick').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-gear]'); if (!b || b.dataset.gear === cmpGear) return;
    cmpGear = b.dataset.gear; store.set('ttd.cmpGear', cmpGear); runCompare();
  });
  $('cmpTable').addEventListener('click', (ev) => {
    const th = ev.target.closest('th[data-sort]'); if (!th) return;
    const k = th.dataset.sort;
    cmpSort = cmpSort.key === k ? { key: k, dir: -cmpSort.dir } : { key: k, dir: CMP_COLS.find((c) => c.k === k)?.low ? 1 : -1 };
    store.set('ttd.cmpSort', cmpSort); renderCompare();
  });
  $('fxRealistic').checked = store.get('ttd.fxRealistic', false);
  const fxRareVis = () => {
    store.set('ttd.fxRealistic', $('fxRealistic').checked);
    $('fxRareList').hidden = !$('fxRealistic').checked;
    const lim = limitedItems().filter((n) => !ACCOUNT_UNIQUE.includes(n));
    $('fxRareList').textContent = `Limited copies: ${lim.map((n) => `${n} ×${copyLimit(n)}`).join(', ')}` +
      ` — plus one per account (×1, always): ${ACCOUNT_UNIQUE.join(', ')}.`;
  };
  $('fxRealistic').addEventListener('change', fxRareVis); fxRareVis();
  const tsaved = store.get('ttd.fxCrowd', { mode: 'single', clump: 8 });
  $('fxTargetMode').value = FX_DENSITY[tsaved.mode] || tsaved.mode === 'single' ? tsaved.mode : 'single';
  $('fxTargets').value = tsaved.clump;
  const fxTargetsVis = () => {
    $('fxTargets').hidden = $('fxTargetMode').value === 'single';
    store.set('ttd.fxCrowd', { mode: $('fxTargetMode').value, clump: Number($('fxTargets').value) || 8 });
  };
  $('fxTargetMode').addEventListener('change', fxTargetsVis); $('fxTargets').addEventListener('change', fxTargetsVis); fxTargetsVis();
  // whip: an account-wide setting (Account Buffs view), saved across reloads
  const savedWhip = store.get('ttd.whip', '0');
  if ([...$('whip').options].some((o) => o.value === savedWhip)) $('whip').value = savedWhip;
  syncWhip();
  $('whip').addEventListener('change', () => syncWhip());
  renderRoleRows();
  $('fxMode').addEventListener('change', () => { saveRoles(); renderRoleRows(); });
  $('fxRoleRows').addEventListener('change', saveRoles);
  $('fxSlots').addEventListener('click', (ev) => { const btn = ev.target.closest('[data-regear]'); if (btn) regearFantasy(Number(btn.dataset.regear)); });
  $('fxSlots').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.matches('[data-cmin],[data-cmax]')) ev.target.closest('.slot').querySelector('[data-regear]').click();
  });
  $('fxLoad').onclick = loadFantasy;
  renderAchievements();

  // restore last build
  const last = store.get('ttd.build', null);
  $('unit').value = last?.unit && D.units[last.unit] ? last.unit : 'Slime Prince';
  onUnitChange(last);

  const savedTeamDef = clampTeamDefense(store.get('ttd.teamDef', 0));
  $('teamDef').value = savedTeamDef; $('teamDefRange').value = savedTeamDef;
  $('teamDef').addEventListener('input', () => {
    const v = clampTeamDefense($('teamDef').value);
    $('teamDefRange').value = v; store.set('ttd.teamDef', v);
  });
  $('teamDef').addEventListener('change', () => {
    const v = clampTeamDefense($('teamDef').value);
    $('teamDef').value = v; $('teamDefRange').value = v; store.set('ttd.teamDef', v);
  });
  $('teamDefRange').addEventListener('input', () => {
    $('teamDef').value = $('teamDefRange').value; store.set('ttd.teamDef', Number($('teamDefRange').value));
  });

  document.body.addEventListener('input', onAnyInput);
  document.body.addEventListener('change', onAnyInput);
  $('unit').addEventListener('change', () => onUnitChange());
  $('enemy').addEventListener('change', () => {
    const e = D.enemies.find((x) => x.name === $('enemy').value);
    if (e) $('def').value = e.Defense || 0;   // HP left to you: it scales by wave, so the bestiary value isn't reliable
    const t = TAGS[$('enemy').value];
    if (t) {   // auto-tick enemy type + time of day (Forest acts: 1-3 day, 4-6 + Blood Moon night)
      $('fSlime').checked = !!t.slime; $('fZombie').checked = !!t.zombie;
      $('fFlying').checked = !!t.flying; $('fBoss').checked = !!t.boss;
      if (t.time === 'day') $('fNight').checked = false;
      if (t.time === 'night') $('fNight').checked = true;
      $('fNight').disabled = t.time !== 'both';
    } else $('fNight').disabled = false;
    let note = $('enemyNote');
    if (!note) { note = document.createElement('p'); note.id = 'enemyNote'; note.className = 'muted'; document.querySelector('#fight .checks').after(note); }
    note.textContent = t ? [t.time === 'both' ? 'Spawns day or night' : `Spawns at ${t.time} only`,
                            t.weather === 'rain' ? 'only while raining' : ''].filter(Boolean).join(' · ') : '';
    render();
  });
  $('saveToTeam').onclick = saveBuildToTeam;
  $('optRun').onclick = runOptimizer;
  $('allItems').innerHTML = [...D.weapons, ...D.armors, ...D.accessories].map((r) => `<option value="${r.name}">`).join('');
  const addExcl = () => {
    const v = $('exclInput').value.trim();
    const real = [...D.weapons, ...D.armors, ...D.accessories].find((r) => r.name.toLowerCase() === v.toLowerCase());
    if (real && !excluded.includes(real.name)) { excluded.push(real.name); store.set('ttd.excluded', excluded); }
    $('exclInput').value = ''; renderExcluded();
  };
  $('exclAdd').onclick = addExcl;
  $('exclInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addExcl(); });
  $('exclChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-un]'); if (!b) return;
    excluded = excluded.filter((n) => n !== b.dataset.un); store.set('ttd.excluded', excluded); renderExcluded();
  });
  wireItemList('fxExclInput', 'fxExclAdd', 'fxExclChips', () => excluded, (l) => { excluded = l; }, 'ttd.excluded');
  renderExcluded();
  $('optTable').addEventListener('click', applyOptimized);
  $('teamSlots').addEventListener('click', onTeamClick);
  $('teamSlots').addEventListener('input', onTeamSlider);
  $('teamSlots').addEventListener('change', (ev) => { if (ev.target.dataset.slot) { ev.stopPropagation(); render(); } });
  $('saveLoadout').onclick = () => {
    const n = $('loadoutName').value.trim(); if (!n) { $('loadoutName').focus(); return; }
    loadouts[n] = structuredClone(team); store.set('ttd.loadouts', loadouts); refreshLoadouts(n);
  };
  $('loadLoadout').onclick = () => {
    const n = $('loadoutPick').value; if (!loadouts[n]) return;
    const repairedLoadout = uniqueTeamSlots(structuredClone(loadouts[n]));
    team = repairedLoadout.team; loadouts[n] = structuredClone(team);
    $('loadoutName').value = n; store.set('ttd.team', team); store.set('ttd.loadouts', loadouts); render();
    showTeamNotice(repairedLoadout.removed.length
      ? `Removed duplicate ${repairedLoadout.removed.join(', ')} from this older loadout. Use each tower's Placements slider for additional copies.`
      : '');
  };
  $('deleteLoadout').onclick = () => {
    const n = $('loadoutPick').value; if (!loadouts[n]) return;
    delete loadouts[n]; store.set('ttd.loadouts', loadouts); refreshLoadouts();
  };
  refreshLoadouts();
  render();
  setupMotionFeedback();
  if (repairedTeamDuplicates.length) showTeamNotice(`Removed duplicate ${repairedTeamDuplicates.join(', ')} from your saved Team. Use each tower's Placements slider for additional copies.`);
  appReady = true;
  if (store.get('ttd.view', 'build') === 'compare' && !cmpRows) runCompare();   // reopened on Compare Towers
}
let appReady = false;

function onUnitChange(restore) {
  const name = $('unit').value, u = D.units[name], rows = D.upgrades[name] || [];
  opts($('tier'), rows.map((r) => String(r.tier)));
  $('tier').value = restore?.tier ?? String(rows.length - 1);
  $('level').disabled = u.can_level === 'no';
  if (u.can_level === 'no') $('level').value = 1;
  const slots = Number(u.accessory_slots) || 0;
  $('slotCount').textContent = `(${slots} slots)`;
  const accNames = D.accessories.map((a) => a.name).sort();
  $('accessories').innerHTML = Array.from({ length: slots }, (_, i) =>
    `<label>Slot ${i + 1}<select class="acc"></select></label>`).join('');
  document.querySelectorAll('.acc').forEach((s, i) => { opts(s, accNames, '— none —'); s.value = restore?.acc?.[i] ?? ''; });
  if (restore) {
    for (const k of ['weapon', 'helmet', 'chest', 'boots', 'reforge', 'level']) if (restore[k] !== undefined) $(k).value = restore[k];
  }
}

const SEAFOOD_MAX = 400;   // Seafood Dinner consume limit
const clampSeafood = (v) => Math.min(SEAFOOD_MAX, Math.max(0, Math.floor(Number(v) || 0)));
const TEAM_DEF_MIN = -5, TEAM_DEF_MAX = 40;
const clampTeamDefense = (v) => Math.min(TEAM_DEF_MAX, Math.max(TEAM_DEF_MIN, Number(v) || 0));
function onAnyInput(ev) {
  const t = ev.target;
  if (t.dataset?.acct) account[t.dataset.acct] = t.checked;
  if (t.id === 'seafood') {
    account.seafood = clampSeafood(t.value);
    if (ev.type === 'change' || Number(t.value) > SEAFOOD_MAX) t.value = account.seafood;   // show the clamped value
    syncSeafood();
  }
  store.set('ttd.account', account);
  render();
}

// One copy of each accessory per unit: clear duplicates and grey out items used in other slots
function enforceUniqueAccessories() {
  const unit = $('unit').value;
  const rowOf = (name) => D.weapons.find((r) => r.name === name) || D.accessories.find((r) => r.name === name) || { name };
  const ok = (name) => !name || allowedFor(rowOf(name), unit);
  // weapon picker: grey out and clear weapons this unit can't use
  const wpn = $('weapon');
  for (const opt of wpn.options) opt.disabled = !ok(opt.value);
  if (!ok(wpn.value)) wpn.value = '';
  const sels = [...document.querySelectorAll('.acc')];
  const seen = new Set();
  for (const sel of sels) {
    if (!ok(sel.value)) sel.value = '';
    if (sel.value && seen.has(sel.value)) sel.value = '';
    if (sel.value) seen.add(sel.value);
  }
  for (const sel of sels) {
    const taken = new Set(sels.filter((o) => o !== sel).map((o) => o.value).filter(Boolean));
    for (const opt of sel.options) opt.disabled = taken.has(opt.value) || !ok(opt.value);
  }
}

function currentBuild() {
  // A select set to a value it doesn't have (e.g. an old saved build) shows blank and would silently mean
  // "no reforge". Heal it: Legendary is the standard reforge.
  if ($('reforge').selectedIndex < 0) $('reforge').value = D.reforges.Legendary ? 'Legendary' : 'None';
  enforceUniqueAccessories();
  const unit = $('unit').value;
  const acc = [...document.querySelectorAll('.acc')].map((s) => s.value);
  const b = { unit, tier: $('tier').value, level: Number($('level').value) || 1, reforge: $('reforge').value,
              weapon: $('weapon').value, helmet: $('helmet').value, chest: $('chest').value, boots: $('boots').value, acc };
  store.set('ttd.build', b);
  return b;
}

function fightOpts() {
  return {
    // the HP box is also the target's HP for lock-on units' kill → re-target pauses
    enemy: { DEF: Number($('def').value) || 0, maxHP: Number($('hp').value) || 0, HP: Number($('hp').value) || 0 },
    opts: { whip: Number($('whip').value) || 0, targets: Number($('targets').value) || 1, pelletsHit: Number($('pellets').value) || 1,
            badLuck: Number($('fBadLuck').value) || 0, lockTargeting: $('fLockOn').value },
    // Slime Whip makes every enemy count as a slime, so the King Slime banner applies to all of them
    fight: { night: $('fNight').checked, boss: $('fBoss').checked, slime: $('fSlime').checked || $('whip').value === 'slime', flying: $('fFlying').checked,
             zombie: $('fZombie').checked, slowed: $('fSlowed').checked, fullHp: $('fFullHp').checked },
  };
}

function stats(b, fight) {
  const items = [b.weapon, b.helmet, b.chest, b.boots, ...b.acc].filter(Boolean);
  const rows = D.upgrades[b.unit];
  const tierRow = rows[Math.min(Number(b.tier) || 0, rows.length - 1)];   // clamp: tier may be stale for a moment while switching units
  const s = computeStats({ unit: D.units[b.unit], tier: tierRow, level: b.level,
                           reforge: D.reforges[b.reforge], items, account, fight }, D.effects);
  s.cost = totalCost(D.upgrades[b.unit], Number(b.tier), s);
  s.items = items;
  return s;
}

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d }) : '—');
const tile = (k, v, s = '', hero = false) => {
  const key = /dps|mana|cost/i.test(k);
  return `<div class="stat${hero ? ' hero' : ''}${key ? ' key' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
};

// Small calculation feedback: only values that actually changed receive the pulse.
const MOTION_VALUE_SELECTOR = '.stat .v, .slot .dps, .slot label';
let motionValues = new Map(), motionFrame = 0, motionObserver = null;
function motionValueKey(el) {
  const owner = el.closest('[id]');
  if (!owner) return null;
  const siblings = [...owner.querySelectorAll(MOTION_VALUE_SELECTOR)];
  const label = el.matches('.stat .v') ? el.parentElement.querySelector('.k')?.textContent.trim() : el.className;
  return `${owner.id}:${siblings.indexOf(el)}:${label || ''}`;
}
function scanMotionValues(animate = true) {
  const next = new Map();
  document.querySelectorAll(MOTION_VALUE_SELECTOR).forEach((el) => {
    const key = motionValueKey(el), value = el.textContent.trim();
    if (!key) return;
    next.set(key, value);
    if (animate && motionValues.has(key) && motionValues.get(key) !== value) {
      el.classList.remove('valueChanged');
      void el.offsetWidth;
      el.classList.add('valueChanged');
      el.addEventListener('animationend', () => el.classList.remove('valueChanged'), { once: true });
    }
  });
  motionValues = next;
}
function setupMotionFeedback() {
  scanMotionValues(false);
  motionObserver?.disconnect();
  motionObserver = new MutationObserver(() => {
    cancelAnimationFrame(motionFrame);
    motionFrame = requestAnimationFrame(() => scanMotionValues(true));
  });
  motionObserver.observe(document.querySelector('main'), { childList: true, characterData: true, subtree: true });
}

// ---------- icons (optional: run tools/fetch_icons.py) ----------
const ICON_CAT = { unit: 'units', weapon: 'weapons', helmet: 'armors', chest: 'armors', boots: 'armors', enemy: 'enemies' };
function iconFor(sel, cat) {
  let img = sel.parentElement.querySelector('img.ico');
  if (!img) {
    img = document.createElement('img'); img.className = 'ico'; img.alt = '';
    const wrap = document.createElement('div'); wrap.className = 'selwrap';
    sel.replaceWith(wrap); wrap.append(img, sel);
  }
  const path = ICONS[cat]?.[sel.value];
  img.style.visibility = path ? 'visible' : 'hidden';
  if (path) img.src = encodeURI(path);
}
// Sprite shown beside each heading. Change any of these to another [category, name] from icons/manifest.json.
const HEADING_ICONS = {
  'header h1': ['units', 'Guide'],
  '#build h2': ['weapons', 'Copper Shortsword'],
  '#fight h2': ['enemies', 'King Slime'],
  '#results h2': ['consumables', 'DPS Meter'],
  '#teamCard h2': ['units', 'Guide'],
  '#actCard h2': ['enemies', 'Eye of Cthulhu'],
  '#acctCard h2': ['consumables', 'Seafood Dinner'],
  '#compareCard h2': ['consumables', 'Golden Crate'],
  '#fantasyCard h2': ['accessories', 'Gold Crown'],
  '#achCard h2': ['accessories', 'Platinum Crown'],
};
function headingIcons() {
  for (const [sel, [cat, name]] of Object.entries(HEADING_ICONS)) {
    const h = document.querySelector(sel), path = ICONS[cat]?.[name];
    if (!h || !path || h.querySelector('img.hico')) continue;
    const img = document.createElement('img'); img.className = 'hico'; img.alt = ''; img.src = encodeURI(path);
    h.prepend(img);
  }
  const fav = ICONS[HEADING_ICONS['header h1'][0]]?.[HEADING_ICONS['header h1'][1]];
  if (fav) { const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' })); l.href = encodeURI(fav); }
}
function updateIcons() {
  for (const [id, cat] of Object.entries(ICON_CAT)) iconFor($(id), cat);
  document.querySelectorAll('.acc').forEach((s) => iconFor(s, 'accessories'));
}

function render() {
  if (!D) return;
  updateIcons();
  updateReforgeShowcase();
  const b = currentBuild(), f = fightOpts(), s = stats(b, f.fight);
  const dps = realDPS(s, f.enemy, f.opts), scr = screenDPS(s);
  const u = D.units[b.unit];
  const placements = Number(u.max_placements) || 1;

  let html = '';
  html += tile('Real DPS vs this enemy', fmt(dps), `per placement · ×${placements} placements = ${fmt(dps * placements)}`, true);
  html += tile('Stat-screen DPS', trunc1(scr), 'DEF 0, no whip — should match the game');
  html += tile('DMG', trunc1(s.DMG_screen), s.situational > 1 ? `in this fight: ${fmt(s.DMG, 2)}` : `×${fmt(s.dmgMult, 3)} total mult`);
  html += tile('SPA', trunc2(s.SPA), `${fmt(1 / s.SPA, 2)} attacks/s`);
  html += tile('RNG', trunc1(s.RNG));
  html += tile('Penetration', s.Pen, `+${s.ignoreDef} from banners`);
  if (s.defMult > 1) html += tile('Defense penalty', `×${s.defMult}`, 'each enemy DEF point removes ' + s.defMult + ' dmg');
  if (s.Splash) html += tile('Splash', fmt(s.Splash));
  if (s.Globe) html += tile('Globe', s.Globe);
  if (s.chains > 1) {
    const used = Math.max(1, Math.min(s.chains, Math.floor(f.opts.chainTargets ?? f.opts.targets) || 1));
    html += tile('Chain', `${used} / ${s.chains} hits @ ${fmt(s.preserve * 100, 0)}%`,
      used < s.chains ? `capped by ${used} enem${used === 1 ? 'y' : 'ies'} available` : 'total crowd damage');
  }
  if (s.pellets > 1) html += tile('Pellets', s.pellets);
  if (s.percent) html += tile('% max HP', `${s.percent}%`, 'raw, ignores DEF, cap 100');
  if (s.critChance || f.opts.badLuck) html += tile('Crit', `${fmt(Math.min(1, s.critChance + (f.opts.badLuck || 0)) * 100, 0)}%`,
    `${fmt(s.critMult, 2)}× damage` + (f.opts.badLuck ? ` · incl. +${fmt(f.opts.badLuck * 100, 0)}% Bad Luck` : ''));
  if (s.doubleAttack) html += tile('Double attack', `${fmt(s.doubleAttack * 100, 0)}%`);
  html += tile('Mana cost', fmt(s.cost, 0), `${fmt(dps / s.cost * 1000, 2)} DPS per 1k mana`);
  html += tile('Damage / attack', fmt(damagePerAttack(s, f.enemy, f.opts), 2), `vs DEF ${f.enemy.DEF}`);
  $('statGrid').innerHTML = html;

  // warnings
  const w = [];
  if (s.retargetDelay) w.push(`🔒 Locks onto one target until it dies, then waits ${s.retargetDelay}s before firing again. Against a ${fmt(f.enemy.HP || 0, 0)} HP enemy that brings real DPS to ${fmt(dps)} (the stat screen ignores the pause; set the HP box to the enemy's HP).`);
  if (s.Globe && s.RNG > s.Globe + 1e-9) w.push(`⚠️ RNG (${trunc1(s.RNG)}) exceeds Globe (${s.Globe}) by ${fmt(s.RNG - s.Globe, 1)}: attacks can trigger on enemies outside the Globe and whiff.`);
  const effDef = Math.max(f.enemy.DEF - s.Pen - s.ignoreDef, 0) * (s.defMult || 1);
  if (s.DMG / (s.pellets || 1) + f.opts.whip - effDef <= s.floor) w.push(`⚠️ Normal hits are at the minimum-damage floor (${s.floor}) against this enemy.`);
  const notes = s.items.map((n) => {
    const r = [...D.weapons, ...D.armors, ...D.accessories].find((x) => x.name === n);
    // set-requirement notes are replaced by the set hint below
    const note = (r?.notes || '').split(' | ').filter((x) => !/Set Bonus activated/i.test(x)).join(' | ');
    return note ? `${n}: ${note}` : null;
  }).filter(Boolean);
  // armor sets (only Boreal Wood and Pumpkin have a bonus): hint only while 1-2 pieces are worn
  const SETS = { 'Boreal Wood': ['Boreal Wood Helmet', 'Boreal Wood Breastplate', 'Boreal Wood Greaves'],
                 'Pumpkin': ['Pumpkin Helmet', 'Pumpkin Breastplate', 'Pumpkin Leggings'] };
  for (const [set, pieces] of Object.entries(SETS)) {
    const worn = pieces.filter((p) => s.items.includes(p));
    if (worn.length === 0 || worn.length === 3) continue;   // hint only for an incomplete set
    const bonus = (D.armors.find((a) => a.name === pieces[0])?.set_bonus || '').replace(/^Set Bonus:\s*/, '').replace(/\s*\(\d\/3\)$/, '');
    const missing = pieces.filter((p) => !worn.includes(p)).map((p) => p.replace(set + ' ', ''));
    notes.unshift(`${worn.length}/3 ${set}: add the ${missing.join(' and ')} for the set bonus (${bonus})`);
  }
  const specials = s.items.map((n) => {
    const r = [...D.weapons, ...D.armors, ...D.accessories].find((x) => x.name === n);
    return r?.special ? `${n}: ${r.special}` : null;
  }).filter(Boolean);
  $('warnings').innerHTML = w.map((x) => `<div>${x}</div>`).join('');
  $('itemNotes').textContent = [...specials.map((x) => `Not modeled — ${x}`), ...notes].join(' · ');

  const fT = withTeamBadLuck(f);   // a placed Black Cat in the Team debuffs enemies for everyone
  drawChart(b, fT);
  renderAct(b, fT);
  renderTeam(fT);
  renderPlan(fT);
  applyBackground();
}

// ---------- act analysis ----------
function actMix() {
  const a = $('act').value, diff = $('diff').value;
  if (appReady) store.set('ttd.act', { act: a, diff });   // never overwrite the saved act while start-up is still restoring it
  if (!a) return null;
  const [biome, , act] = a.split(' ');
  const rows = SPAWNS.filter((r) => r.biome === biome && String(r.act) === act && r.difficulty === diff);
  return rows.map((r) => {
    const e = D.enemies.find((x) => x.name === r.enemy) || {};
    return { name: r.enemy, count: r.count, boss: r.is_boss_entry === 1, HP: Number(e.Health) || 0, DEF: Number(e.Defense) || 0 };
  });
}
function fightFor(name) {
  const t = TAGS[name] || {};
  return { night: t.time === 'night', boss: !!t.boss, slime: !!t.slime || $('whip').value === 'slime',
           flying: !!t.flying, zombie: !!t.zombie, slowed: false, fullHp: false };
}
// Count-weighted average of your DPS against each enemy in the act.
// Each enemy's bestiary max HP drives % max-HP damage (Digtoise, Flinx) and lock-on re-target pauses.
function actDPS(b, mix, f) {
  // Lock-on units (Suspicious Eye): time-correct rate = HP killed ÷ (kill time + re-target pause per kill).
  // "Strong" targeting picks the tankiest enemy on screen, so kills are weighted by HP (the trash dies to others).
  const s0 = stats(b, {});
  if (s0.retargetDelay > 0) {
    const strong = (f.opts.lockTargeting || 'strong') === 'strong';
    let hp = 0, time = 0;
    for (const m of mix) {
      if (!(m.HP > 0)) continue;
      const raw = realDPS(stats(b, fightFor(m.name)), { DEF: m.DEF, maxHP: m.HP, HP: 0 }, f.opts);   // HP 0: no pause
      const w = m.count * (strong ? m.HP : 1);
      hp += w * m.HP; time += w * (m.HP / raw + s0.retargetDelay);
    }
    if (time > 0) return hp / time;
  }
  let n = 0, tot = 0;
  for (const m of mix) {
    // each enemy's own max HP drives % max-HP damage (Digtoise, Flinx)
    const d = realDPS(stats(b, fightFor(m.name)), { DEF: m.DEF, maxHP: m.HP, HP: m.HP }, f.opts);
    n += m.count; tot += m.count * d;
  }
  return tot / n;
}
// "Rank accessories for": every filled Team slot by tower name (+ the Build panel), and that tower's accessory slots
function rankTarget(buildPanel) {
  const filled = team.map((t, i) => ({ t, i }))
    .filter(({ t }) => t && D.units[t.build.unit] && !CHART_EXCLUDED_UNITS.has(t.build.unit));
  const count = {}; filled.forEach(({ t }) => { count[t.build.unit] = (count[t.build.unit] || 0) + 1; });
  const choices = filled.map(({ t, i }) => ({ value: String(i), label: t.build.unit + (count[t.build.unit] > 1 ? ` (team slot ${i + 1})` : ''),
                                              b: { ...t.build, acc: [...t.build.acc], tier: String(t.tier) } }));
  if (!CHART_EXCLUDED_UNITS.has(buildPanel.unit)) choices.push({ value: 'build', label: `Build panel: ${buildPanel.unit}`, b: buildPanel });
  const tSel = $('rankTower'), prevT = tSel.value || store.get('ttd.rankTower', '');
  const sSel = $('rankSlot');
  if (!choices.length) {
    tSel.innerHTML = '<option>No attacking towers</option>'; sSel.innerHTML = ''; return null;
  }
  tSel.innerHTML = choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
  tSel.value = choices.some((c) => c.value === prevT) ? prevT : choices[0].value;
  store.set('ttd.rankTower', tSel.value);
  const rb = choices.find((c) => c.value === tSel.value).b;
  const prevS = sSel.selectedIndex;
  sSel.innerHTML = rb.acc.map((a, i) => `<option>Slot ${i + 1}: ${a || 'empty'}</option>`).join('');
  sSel.selectedIndex = rb.acc.length ? Math.min(Math.max(prevS, 0), rb.acc.length - 1) : -1;
  return rb;
}
// 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', 22 -> '22nd'
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
// Bad Luck from a Black Cat in the Team (placed), at its upgrade tier; the Enemy Select value is the floor
function teamBadLuck() {
  const rows = D.upgrades['Black Cat'] || [];
  return Math.max(0, ...team.filter((t) => t && t.build.unit === 'Black Cat' && t.placements > 0)
    .map((t) => (Number(rows[Math.min(t.tier, rows.length - 1)]?.['Bad Luck']) || 0) / 100));
}
function withTeamBadLuck(f) {
  const bl = Math.max(f.opts.badLuck || 0, teamBadLuck());
  return bl === (f.opts.badLuck || 0) ? f : { ...f, opts: { ...f.opts, badLuck: bl } };
}
function teamMembers() {
  return team.map((t, i) => ({ t, i })).filter(({ t }) => t && D.units[t.build.unit] && t.placements > 0)
    .map(({ t, i }) => ({ slot: i, t, b: { ...t.build, tier: String(t.tier) } }));
}
function renderAct(b, f) {
  const mix = actMix();
  if (!mix || !mix.length) { $('actStats').innerHTML = '<p class="muted">Pick an act to see its enemy mix.</p>'; $('actTable').innerHTML = ''; $('rankTable').innerHTML = ''; $('buildsTable').innerHTML = ''; return; }
  const n = mix.reduce((t, m) => t + m.count, 0);
  const avgDef = mix.reduce((t, m) => t + m.count * m.DEF, 0) / n;
  const ico = (cat, name) => ICONS[cat]?.[name] ? `<img class="ico" src="${encodeURI(ICONS[cat][name])}" alt="">` : '';

  // ---- the Team (5 slots) vs this act ----
  const members = teamMembers().filter((m) => !CHART_EXCLUDED_UNITS.has(m.b.unit)).map((m) => {
    const each = actDPS(m.b, mix, f);
    return { ...m, each, total: each * m.t.placements };
  });
  const teamDps = members.reduce((t, m) => t + m.total, 0);

  $('actStats').innerHTML =
    (members.length
      ? tile('Team Act DPS', fmt(teamDps), `${members.length} towers · ${members.reduce((t, m) => t + m.t.placements, 0)} placements`, true)
      : tile('Team Act DPS', '—', 'Add attacking towers in Team & Defense', true)) +
    tile('Avg DEF', fmt(avgDef, 1), 'per enemy') +
    tile('Enemies', `${fmt(n, 0)}${mix.some((m) => m.boss) ? '+' : ''}`, mix.some((m) => m.boss) ? '+ boss minions' : '');

  $('actTable').innerHTML = '<tr><th>Enemy</th><th>#</th><th>% of enemies</th><th>DEF</th></tr>' +
    mix.map((m) => `<tr><td>${ico('enemies', m.name)}${m.name}${m.boss ? ' 👑' : ''}</td><td>${m.count}</td><td>${fmt(m.count / n * 100, 0)}%</td><td>${m.DEF}</td></tr>`).join('');

  // per-tower breakdown
  $('buildsTable').innerHTML = members.length
    ? '<tr><th>Tower</th><th>Upgrade</th><th>Placements</th><th>Total DPS</th><th>% of team</th></tr>' +
      members.map((m) => `<tr><td>${ico('units', m.b.unit)}${m.b.unit}</td><td>${m.t.tier}/${D.upgrades[m.b.unit].length - 1}</td><td>${m.t.placements}</td><td>${fmt(m.total)}</td><td>${fmt(teamDps ? m.total / teamDps * 100 : 0, 0)}%</td></tr>`).join('')
    : '<tr><td class="muted" style="text-align:left">No attacking towers in Team & Defense yet.</td></tr>';

  // accessory ranking: pick a Team tower (by name), then swap every accessory into one of its slots
  const rb = rankTarget(b);
  if (!rb) {
    $('rankTitle').textContent = 'Best accessory vs this act';
    $('rankTable').innerHTML = '<tr><td class="muted" style="text-align:left">Add an attacking tower to rank accessories.</td></tr>';
    return;
  }
  const slot = Math.max(0, $('rankSlot').selectedIndex);
  const others = rb.acc.filter((_, i) => i !== slot);
  const cands = ['', ...D.accessories.map((a) => a.name).filter((n) => !others.includes(n) && allowedFor(D.accessories.find((r) => r.name === n), rb.unit))];
  const curDps = actDPS(rb, mix, f);
  const ranked = cands.map((name) => {
    const acc = [...rb.acc]; acc[slot] = name;
    return { name, dps: actDPS({ ...rb, acc }, mix, f) };
  }).sort((x, y) => y.dps - x.dps);
  $('rankTitle').innerHTML = `${ico('units', rb.unit)}Best accessory for ${rb.unit} vs this act <span class="muted">(per placement)</span>`;
  const currentName = rb.acc[slot] || '';
  const shown = [...ranked.slice(0, 5)];
  const current = ranked.find((r) => r.name === currentName);
  if (current && !shown.some((r) => r.name === current.name)) shown.push(current);
  $('rankTable').innerHTML = !rb.acc.length ? `<tr><td class="muted" style="text-align:left">${rb.unit} has no accessory slots.</td></tr>` :
    '<tr><th>Accessory</th><th>Act DPS</th><th>vs current</th></tr>' +
    shown.map((r) => {
      const dlt = (r.dps / curDps - 1) * 100;
      const cls = Math.abs(dlt) < 0.05 ? '' : dlt > 0 ? 'up' : 'down';
      return `<tr class="${r.name === currentName ? 'cur' : ''}"><td>${ico('accessories', r.name)}${r.name || '— empty —'}</td><td>${fmt(r.dps)}</td><td class="${cls}">${dlt >= 0 ? '+' : ''}${fmt(dlt, 1)}%</td></tr>`;
    }).join('');
}

// Results panel: put the current Build into a chosen Team slot
function uniqueTeamSlots(list) {
  const source = Array.isArray(list) ? list : [];
  const seen = new Set(), removed = [];
  const clean = Array.from({ length: 5 }, (_, i) => {
    const t = source[i] || null, unit = t?.build?.unit;
    if (!unit) return t;
    if (seen.has(unit)) { removed.push(unit); return null; }
    seen.add(unit); return t;
  });
  return { team: clean, removed: [...new Set(removed)] };
}
function showTeamNotice(message) {
  const el = $('teamNotice');
  if (!el) return;
  el.textContent = message; el.hidden = !message;
}
function setTeamSlot(i) {
  const b = currentBuild();
  const duplicate = team.findIndex((t, j) => j !== i && t?.build?.unit === b.unit);
  if (duplicate >= 0) {
    showTeamNotice(`${b.unit} is already in Slot ${duplicate + 1}. Use that card's Placements slider for additional copies.`);
    return false;
  }
  const max = D.upgrades[b.unit].length - 1;
  team[i] = { build: { ...b, acc: [...b.acc] }, tier: Number(b.tier ?? max),
              placements: Number(D.units[b.unit].max_placements) || 1 };
  showTeamNotice('');
  return true;
}
function refreshTeamSlotPick() {
  const sel = $('teamSlotPick'), prev = sel.value;
  sel.innerHTML = team.map((t, i) =>
    `<option value="${i}">Slot ${i + 1}: ${t && D.units[t.build.unit] ? t.build.unit : 'empty'}</option>`).join('');
  const firstEmpty = team.findIndex((t) => !t);
  sel.value = prev !== '' && sel.querySelector(`option[value="${prev}"]`) ? prev : String(firstEmpty >= 0 ? firstEmpty : 0);
}
// ---------- fantasy teams ----------
// 1) best gear per unit (independent: item copies are allowed across towers), 2) pick the team.
const fxCache = new Map();   // context+unit+mode -> best build at max tier
let fxLast = null;
const fxPause = () => new Promise((r) => setTimeout(r, 0));
const WHIP_NAME = { 1: 'Cobwhip', 2: 'Leather Whip', slime: 'Slime Whip' };
function syncWhip() {
  const v = $('whip').value;
  store.set('ttd.whip', v);
  const name = WHIP_NAME[v], row = name && (D.whips || []).find((w) => w.name === name);
  const ico = name && ICONS.whips?.[name] ? `<img src="${encodeURI(ICONS.whips[name])}" alt="">` : '';
  const what = !name ? 'No whip: towers deal their normal damage.'
    : v === 'slime' ? 'Every enemy counts as a slime, so the King Slime banner (+10% vs. slimes) applies to all of them.'
    : `+${v} damage on every hit (added before defense, so it also helps against armored enemies).`;
  const html = `${ico}<span><b>${name || 'None'}</b> — ${what}${row?.obtain ? `<br><span class="muted">${row.obtain}</span>` : ''}</span>`;
  $('whipInfo').innerHTML = html;
}
function syncSeafood() {
  const count = clampSeafood($('seafood').value);
  const bonus = count * 0.05;
  const path = ICONS.consumables?.['Seafood Dinner'];
  const ico = path ? `<img src="${encodeURI(path)}" alt="">` : '';
  $('seafoodInfo').innerHTML = `${ico}<span><b>Seafood Dinner</b> — Permanently boosts every unit's DMG by 0.05% per dinner, up to 20.00% at 400.
    <br><span class="seafoodBonus">Current: ${count} dinner${count === 1 ? '' : 's'} · +${bonus.toFixed(2)}% DMG</span>
    <br><span class="muted">Crafting: 2 Damselfish + (1 Salmon or 1 Rock Lobster).</span></span>`;
}
// Fantasy's crowd setting: enemies per splash-unit of lane; one hit catches max(1, min(clump, density·2·Splash)).
// Splash radius is linear in the Splash stat (in-game circles for Splash 2/4/8: 1× / 2.1× / 4.4× wide).
// light:  Journey Act 1 waves 1–4      → Splash 2/4/8 caught ~1 / ~2 / ~2–3   (fit 0.18 → 1 / 1.4 / 2.9)
// medium: Forest Master Blood Moon w1–5 → Splash 2/4/8 caught ~1.5 / ~3 / ~6 (fit 0.375 → 1.5 / 3 / 6)
const FX_DENSITY = { light: 0.18, medium: 0.375 };
function fxCrowd() {
  const m = $('fxTargetMode').value;
  if (!FX_DENSITY[m]) return null;
  return { mode: m, density: FX_DENSITY[m], clump: Math.max(2, Math.min(40, Math.round(Number($('fxTargets').value) || 8))) };
}
function fxContext() {
  const f = fightOpts(), mix = actMix();
  const crowd = fxCrowd();
  // single-target → chains get only their first hit; crowd → chains can reach up to the clump size
  f.opts = { ...f.opts, targets: 1, chainTargets: crowd ? crowd.clump : 1, ...(crowd ? { density: crowd.density, clump: crowd.clump } : {}) };
  const dps = (b) => (mix && mix.length ? actDPS(b, mix, f) : realDPS(stats(b, f.fight), f.enemy, f.opts));
  const vs = (mix && mix.length ? `${$('act').value} (${$('diff').value})` : `${$('enemy').value || 'custom enemy'} (DEF ${f.enemy.DEF})`) +
             (crowd ? ` · ${crowd.mode} crowd (clumps ≤ ${crowd.clump})` : ' · single-target');
  const key = JSON.stringify([vs, f, account]);
  return { dps, vs, key };
}
// r.realRng is the tower's actual range (r.rng may be repurposed as the band check, see fxBestBuild)
// Control: enemy-seconds of Confusion per second (non-boss enemies frozen in place), medium crowd for splash
function controlRate(st) {
  if (!st.confusion) return 0;
  const caught = st.Splash > 0 ? Math.max(1, Math.min(8, FX_DENSITY.medium * 2 * st.Splash)) : 1;
  return caught * st.confusion / st.SPA;
}
const FX_SCORE = { control: (r) => r.control * 1e6 + r.dps, dps: (r) => r.dps, efficiency: (r) => r.dps / r.cost, rng: (r) => r.realRng * 1e6 + r.dps,
                   luck: (r) => r.dps * r.luck };   // lucky kills: luck only counts on the tower's own kills
const INVERTED_RANGE_UNITS = new Set(['Zoologist']);   // summons travel from the map exit toward the entrance
// Range band (set by hand, applies to every goal; economy towers are exempt since they don't attack).
// Both boxes blank = ignore range (null); one blank side = open-ended.
function fxBand() {
  const read = (id) => ($(id).value.trim() === '' ? null : Number($(id).value));
  let lo = read('fxRngMin'), hi = read('fxRngMax');
  if (lo === null && hi === null) return null;
  lo ??= 0; hi ??= Infinity;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}
const bandText = ([lo, hi]) => (hi === Infinity ? `${lo}+` : `${lo}–${hi}`);
const bandDist = (rng, [lo, hi]) => (rng < lo ? lo - rng : rng > hi ? rng - hi : 0);
function fxBestBuild(unit, mode, ctx, forbid = []) {
  const invertedRange = INVERTED_RANGE_UNITS.has(unit);
  const band = ECO_UNITS.includes(unit) || invertedRange ? null : ctx.band;   // merchants and reverse-path summons ignore the range band
  const goalMode = invertedRange && mode === 'rng' ? 'dps' : mode;
  const rows = D.upgrades[unit];
  const maxTier = String(Math.min(rows.length - 1, ctx.tierFor?.(unit) ?? rows.length - 1));   // rankings may score a unit below max
  const ck = ctx.key + '|' + unit + '|' + mode + '|' + band + '|t' + maxTier + '|' + [...excluded, '/', ...[...forbid].sort()].join(',');
  if (fxCache.has(ck)) return fxCache.get(ck);
  const slots = Number(D.units[unit].accessory_slots) || 0;
  const base = { unit, tier: maxTier, level: 45, reforge: 'None', weapon: '', helmet: '', chest: '', boots: '', acc: Array(slots).fill('') };
  const evalB = (b) => { const st = stats(b, {}); return { dps: ctx.dps(b), realRng: st.RNG, cost: st.cost, luck: st.luck, control: controlRate(st), dist: band ? bandDist(st.RNG, band) : 0 }; };
  // with a band: anything outside it ranks below everything inside it, closest-to-the-band first
  const scoreFn = (r) => {
    if (r.dist > 0) return -1e12 - r.dist;
    const primary = FX_SCORE[goalMode](r);
    // Zoologist maximizes damage first; among effectively tied builds, less RNG is better.
    return invertedRange ? primary * 1e6 - r.realRng : primary;
  };
  const reforges = Object.keys(D.reforges);
  const bestReforge = (b) => reforges.map((r) => ({ r, s: scoreFn(evalB({ ...b, reforge: r })) })).sort((x, y) => y.s - x.s)[0].r;
  const ok = (rows2) => rows2.filter((r) => allowedFor(r, unit) && !excluded.includes(r.name) && !forbid.includes(r.name)).map((r) => r.name);
  const armor = (part) => ok(D.armors.filter((a) => a.group.endsWith(part)));
  const gs = [{ key: 'weapon', options: ['', ...ok(D.weapons)] }, { key: 'helmet', options: ['', ...armor('Helmet')] },
              { key: 'chest', options: ['', ...armor('Chestplate')] }, { key: 'boots', options: ['', ...armor('Boots')] }];
  const accNames = ok(D.accessories);
  for (let i = 0; i < slots; i++) gs.push({ key: 'acc' + i, group: 'acc', options: ['', ...accNames] });
  const toB = (L) => ({ ...base, weapon: L.weapon, helmet: L.helmet, chest: L.chest, boots: L.boots, acc: base.acc.map((_, i) => L['acc' + i] || '') });
  const start = { weapon: '', helmet: '', chest: '', boots: '' }; base.acc.forEach((_, i) => { start['acc' + i] = ''; });
  // the optimizer's min-range rule doubles as the band check: rng = −(distance outside the band), required ≥ 0
  const evaluate = (L) => { const r = evalB(toB(L)); return { ...r, rng: -r.dist }; };
  // full gear search with the reforge held fixed
  const searchWith = (reforge) => {
    base.reforge = reforge;
    const res = optimize({ slots: gs, start, evaluate, mode, scoreFn, minRng: 0, rules: { conflicts: CONFLICTS },
                           restarts: 25, top: 1, exhaustiveLimit: 15000 });
    const b = toB(res.results[0].loadout);
    return { b, r: evalB(b) };
  };
  let b;
  if (goalMode !== 'rng' && D.reforges.Legendary) {
    // Stay on Legendary whenever any gear makes it work; only if no gear can reach the band with Legendary
    // does a weaker reforge get a turn — each searched with its own full gear set, the best one kept.
    let best = searchWith('Legendary');
    if (best.r.dist > 0) {
      // only reforges that move range the right way can help: more RNG if Legendary fell short, less if it overshot
      const short = best.r.realRng < band[0], legR = D.reforges.Legendary.RNG;
      for (const rf of reforges) {
        if (rf === 'Legendary') continue;
        if (short ? !(D.reforges[rf].RNG > legR) : !(D.reforges[rf].RNG < legR)) continue;
        const c = searchWith(rf);
        if (scoreFn(c.r) > scoreFn(best.r)) best = c;
      }
    }
    b = best.b;
  } else {
    // Most RNG: range is the goal, so the reforge is chosen freely
    base.reforge = bestReforge(base);
    b = searchWith(base.reforge).b;
    b.reforge = bestReforge(b);
  }
  fxCache.set(ck, b);
  return b;
}
// every (tier, placements) option for one unit, with gear fixed from the max-tier search
function fxOptions(b, ctx, band = null) {
  const rows = D.upgrades[b.unit], maxPl = Number(D.units[b.unit].max_placements) || 1;
  const out = [];
  for (let t = 0; t < rows.length; t++) {
    const bt = { ...b, tier: String(t) }, st = stats(bt, {});
    const each = ctx.dps(bt);
    if (band && bandDist(st.RNG, band) > 0) continue;   // this tier's range is outside the band
    for (let p = 1; p <= maxPl; p++) out.push({ tier: t, placements: p, each, dps: each * p, cost: st.cost * p, rng: st.RNG, luck: st.luck });
  }
  return out;
}
// Cheapest combination of up to maxPlacements copies that reaches a DPS breakpoint.
// Copies may be at different upgrade tiers. After each placement, discard every state
// that costs at least as much as another state while doing no more damage.
function minCostForDps(onePlacementOptions, maxPlacements, target) {
  let frontier = [{ dps: 0, cost: 0 }];
  for (let p = 0; p < maxPlacements; p++) {
    const candidates = [...frontier];   // keep setups that use fewer than the placement cap
    for (const s of frontier) for (const o of onePlacementOptions) {
      candidates.push({ dps: Math.min(target, s.dps + o.each), cost: s.cost + o.cost });
    }
    candidates.sort((a, b) => a.cost - b.cost || b.dps - a.dps);
    const next = []; let bestDps = -Infinity;
    for (const c of candidates) if (c.dps > bestDps + 1e-9) { next.push(c); bestDps = c.dps; }
    frontier = next;
  }
  const hit = frontier.filter((s) => s.dps >= target - 1e-9);
  return hit.length ? Math.min(...hit.map((s) => s.cost)) : Infinity;
}
// ---- slot roles: every slot may carry its own range band (blank = the default band) ----
const FX_SLOTS = 5;
const readBand = (minEl, maxEl) => {
  const rd = (el) => (el.value.trim() === '' ? null : Number(el.value));
  let lo = rd(minEl), hi = rd(maxEl);
  if (lo === null && hi === null) return null;
  lo ??= 0; hi ??= Infinity;
  return [Math.min(lo, hi), Math.max(lo, hi)];
};
function renderRoleRows() {
  const saved = store.get('ttd.fxRoles', []), eco = $('fxMode').value === 'eco';
  $('fxRoleRows').innerHTML = Array.from({ length: FX_SLOTS }, (_, i) => {
    const lock = eco && i === FX_SLOTS - 1;
    return `<div class="fxRole${lock ? ' locked' : ''}"><span>${ordinal(i + 1)} slot</span>` + (lock
      ? `<span class="muted">${FX_ECO_UNIT} (no range needed)</span>`
      : `<input type="number" min="0" data-role="${i}" data-side="min" placeholder="min" value="${saved[i]?.[0] ?? ''}"> to
         <input type="number" min="0" data-role="${i}" data-side="max" placeholder="max" value="${saved[i]?.[1] ?? ''}">`) + '</div>';
  }).join('');
}
function slotBands() {
  const def = fxBand(), roles = [];
  for (let i = 0; i < FX_SLOTS; i++) {
    const mn = document.querySelector(`[data-role="${i}"][data-side="min"]`), mx = document.querySelector(`[data-role="${i}"][data-side="max"]`);
    roles.push(mn && mx ? (readBand(mn, mx) ?? def) : def);
  }
  return roles;
}
function saveRoles() {
  store.set('ttd.fxRoles', Array.from({ length: FX_SLOTS }, (_, i) => ['min', 'max'].map((sd) =>
    document.querySelector(`[data-role="${i}"][data-side="${sd}"]`)?.value ?? '')));
}

const FX_ECO_UNIT = 'Star Merchant';
// Items the Star Merchant never takes: worth more on a damage tower than the small income edge (Jolt's call).
// Its weapon priority therefore runs Arkhalis → Sand Gun → … by mana/sec.
const FX_ECO_AVOID = ['Copper Shortsword'];
let fxMeta = null;   // the last run's settings, so a card can be re-geared later
async function runFantasy() {
  const goal = $('fxMode').value, eco = goal === 'eco' && !!D.units[FX_ECO_UNIT];
  const mode = goal === 'eco' ? 'dps' : goal;          // the damage slots are picked like Most DPS
  const fullBudget = Number($('fxBudget').value) || 0;
  let budget = fullBudget;
  const ctx = fxContext();
  saveRoles();
  const units = Object.keys(D.units).filter((u) => D.upgrades[u]?.length);
  const fighters = units.filter((u) => !NON_DAMAGING_UNITS.includes(u));
  $('fxRun').disabled = true;
  const t0 = performance.now();
  const forbid = Object.fromEntries(fighters.map((u) => [u, []]));   // unit -> one-copy items it may NOT use
  const owner = {};                                                   // limited item -> [units that got a copy]
  const ecoHeld = {};                                                 // limited item -> copies the Star Merchant took
  // Most DPS + Eco: Star Merchant first — best mana/sec gear, and first claim on every one-copy item it uses
  let ecoPick = null;
  if (eco) {
    $('fxStatus').textContent = `Finding the best gear for ${FX_ECO_UNIT}…`; await fxPause();
    const ecoCtx = { ...ctx, key: ctx.key + '|eco', band: null, dps: (b) => { const st = stats(b, {}); return st.DMG / st.SPA; } };
    const smB = fxBestBuild(FX_ECO_UNIT, 'dps', ecoCtx, FX_ECO_AVOID);
    for (const item of fxGear(smB)) if (isOneCopy(item)) {
      ecoHeld[item] = 1;
      if (copyLimit(item) <= 1) { owner[item] = [FX_ECO_UNIT]; for (const u of fighters) forbid[u].push(item); }
    }
    const tier = D.upgrades[FX_ECO_UNIT].length - 1, pl = Number(D.units[FX_ECO_UNIT].max_placements) || 1;
    const st = stats(smB, {}), mps = st.DMG / st.SPA;
    ecoPick = { c: { b: smB }, o: { tier, placements: pl, each: mps, dps: 0, mps: mps * pl, cost: st.cost * pl, rng: st.RNG }, band: null };
    if (budget) {
      budget -= ecoPick.o.cost;
      if (budget <= 0) {
        $('fxStatus').textContent = `A ${FX_ECO_UNIT} alone costs ${fmt(ecoPick.o.cost, 0)} mana — raise the budget.`;
        $('fxSlots').innerHTML = ''; $('fxStats').innerHTML = ''; $('fxLoadRow').hidden = true; fxLast = null;
        $('fxRun').disabled = false; return;
      }
    }
  }
  const bands = slotBands().slice(0, eco ? FX_SLOTS - 1 : FX_SLOTS);
  const distinct = [...new Map(bands.map((b) => [bandKey(b), b])).values()];
  const candFor = (u, band, extra = []) => {
    const c2 = { ...ctx, band };
    const b = fxBestBuild(u, mode, c2, [...forbid[u], ...extra]);
    return { b, options: fxOptions(b, c2, band) };
  };
  let picks;
  for (let round = 0; round < 8; round++) {
    const cands = [];
    for (let i = 0; i < fighters.length; i++) {
      $('fxStatus').textContent = `Finding the best gear for ${fighters[i]} (${i + 1}/${fighters.length})` +
        `${distinct.length > 1 ? ` · ${distinct.length} slot roles` : ''}${round ? ` · sharing one-copy items, pass ${round + 1}` : ''}…`;
      await fxPause();
      const byBand = {};
      for (const band of distinct) byBand[bandKey(band)] = candFor(fighters[i], band);
      if (Object.values(byBand).some((x) => x.options.length)) cands.push({ unit: fighters[i], byBand });
    }
    picks = fxAssign(cands, bands, mode, budget);
    // limited items worn by more towers than there are copies: keep them on the towers that would lose the most
    let changed = false;
    for (const item of limitedItems()) {
      if (owner[item]) continue;
      const avail = copyLimit(item) - (ecoHeld[item] || 0);
      const users = picks.filter((p) => p && fxGear(p.c.b).includes(item));
      if (users.length <= avail) continue;
      const loss = users.map(({ c, o, band }) => {
        const alt = candFor(c.b.unit, band, [item]).options.find((x) => x.tier === o.tier && x.placements === o.placements);
        return { u: c.b.unit, loss: o.dps - (alt ? alt.dps : 0) };
      }).sort((a, b) => b.loss - a.loss);
      owner[item] = [...(ecoHeld[item] ? [FX_ECO_UNIT] : []), ...loss.slice(0, avail).map((x) => x.u)];
      for (const u of fighters) if (!owner[item].includes(u)) forbid[u].push(item);
      changed = true;
    }
    if (!changed) break;
  }
  if (eco) picks = [...picks, ecoPick];   // 5th slot
  fxLast = picks.map((p) => p && ({ build: { ...p.c.b, acc: [...p.c.b.acc], tier: String(p.o.tier) }, tier: p.o.tier, placements: p.o.placements, o: p.o, band: p.band }));
  fxMeta = { mode, ctx, budget: fullBudget, bands };
  renderFantasy();
  const shared = Object.entries(owner).map(([it, us]) => [it, us.filter((u) => fxLast.some((x) => x?.build.unit === u))])
    .filter(([, us]) => us.length).map(([it, us]) => [it, us.join(' + ')]);
  const empty = fxLast.map((x, i) => (x ? null : `${ordinal(i + 1)} slot (${bands[i] ? bandText(bands[i]) : 'any'})`)).filter(Boolean);
  $('fxStatus').textContent = `Searched ${fighters.length} towers in ${fmt((performance.now() - t0) / 1000, 1)}s · vs ${ctx.vs}` +
    (shared.length ? ` · limited items: ${shared.map(([it, u]) => `${it} → ${u}`).join(', ')}` : '') +
    (empty.length ? ` · ⚠️ nothing fits: ${empty.join(', ')}` : '');
  $('fxRun').disabled = false;
}
const fxGear = (b) => [b.weapon, b.helmet, b.chest, b.boots, ...b.acc].filter(Boolean);

// C: re-gear one card's tower for its own band, keeping the rest of the team as is
function regearFantasy(i) {
  const x = fxLast?.[i]; if (!x || !fxMeta) return;
  const card = $('fxSlots').children[i];
  const band = readBand(card.querySelector('[data-cmin]'), card.querySelector('[data-cmax]'));
  // limited items stay with the other towers: off-limits here once the others already use every copy
  const others = fxLast.flatMap((y, j) => (y && j !== i ? fxGear(y.build) : [])).filter(isOneCopy);
  const taken = [...new Set(others)].filter((n) => others.filter((m) => m === n).length >= copyLimit(n));
  const c2 = { ...fxMeta.ctx, band };
  const b = fxBestBuild(x.build.unit, fxMeta.mode, c2, taken);
  const options = fxOptions(b, c2, band);
  const sameP = options.filter((o) => o.placements === x.placements);
  const o = sameP.find((q) => q.tier === x.tier) || (sameP.length ? sameP.reduce((a, q) => (FX_OPT_SCORE[fxMeta.mode](q) > FX_OPT_SCORE[fxMeta.mode](a) ? q : a)) : null);
  if (!o) { card.querySelector('.fxMsg').textContent = `${x.build.unit} can't reach ${band ? bandText(band) : 'that band'} at ×${x.placements}.`; return; }
  fxLast[i] = { build: { ...b, acc: [...b.acc], tier: String(o.tier) }, tier: o.tier, placements: o.placements, o, band };
  renderFantasy();
  $('fxSlots').children[i].querySelector('.fxMsg').textContent = `Re-geared for ${band ? bandText(band) : 'no range limit'}.`;
}

function renderFantasy() {
  const { mode, budget, ctx } = fxMeta;
  const live = fxLast.filter(Boolean), fighters = live.filter((x) => !x.o.mps);
  const dps = live.reduce((t, x) => t + x.o.dps, 0), mana = live.reduce((t, x) => t + x.o.cost, 0);
  const pl = live.reduce((t, x) => t + x.placements, 0);
  const over = budget && mana > budget + 1e-6;
  $('fxStats').innerHTML =
    tile('Team DPS', fmt(dps), ctx.vs, true) +
    tile('Total mana', fmt(mana, 0), budget && mode === 'dps' ? `${over ? '⚠️ over ' : ''}budget ${fmt(budget, 0)}` : `${pl} placements`) +
    tile('DPS / 1k mana', mana ? fmt(dps / mana * 1000, 2) : '—', 'cost efficiency') +
    (live.some((x) => x.o.mps) ? tile('Mana / sec', fmt(live.reduce((t, x) => t + (x.o.mps || 0), 0), 2), `${FX_ECO_UNIT} income`) : '') +
    tile('Avg range', fighters.length ? fmt(fighters.reduce((t, x) => t + x.o.rng, 0) / fighters.length, 1) : '—', 'per damage tower') +
    (live.some((x) => (x.o.luck ?? 1) > 1) ? tile('Avg luck per kill',
      `×${fmt(fighters.reduce((t, x) => t + x.o.dps * (x.o.luck ?? 1), 0) / Math.max(1e-9, fighters.reduce((t, x) => t + x.o.dps, 0)), 2)}`,
      'kills split by DPS', mode === 'luck') : '');
  const bandVal = (band, k) => (band ? (k === 0 ? band[0] || '' : band[1] === Infinity ? '' : band[1]) : '');
  $('fxSlots').innerHTML = fxLast.map((x, i) => {
    if (!x) return `<div class="slot empty"><div class="name">${ordinal(i + 1)} slot: empty</div>
      <div class="muted">No tower reaches ${fxMeta.bands[i] ? bandText(fxMeta.bands[i]) : 'this role'}.</div></div>`;
    const g = x.build, u = D.units[g.unit], maxTier = D.upgrades[g.unit].length - 1;
    const ones = fxGear(g).filter(isOneCopy);
    return `<div class="slot reforgeCard towerBackdrop fantasyTowerCard" style="${towerCardStyle(g.unit)}">
      ${towerCardVisual(g, u.can_level === 'no' ? 1 : 45)}
      <div class="muted fantasyBuildMeta">${ordinal(i + 1)} slot · Upgrade ${x.tier}/${maxTier} · ×${x.placements}</div>
      ${ones.length ? `<div class="muted">★ Limited: ${ones.join(', ')}</div>` : ''}
      ${x.o.mps
        ? `<div class="dps">${fmt(x.o.mps, 2)} mana/s</div>
      <div class="muted">${fmt(x.o.cost, 0)} mana · pays back in ${fmt(x.o.cost / x.o.mps, 0)} s</div>`
        : `<div class="dps">${fmt(x.o.dps)} DPS</div>
      <div class="muted">${fmt(x.o.each)} each · ${fmt(x.o.cost, 0)} mana · RNG ${fmt(x.o.rng, 1)}${(x.o.luck ?? 1) > 1 ? ` · Luck ×${fmt(x.o.luck, 2)}` : ''}</div>
      <div class="fxCardBand"><input type="number" min="0" data-cmin placeholder="min" value="${bandVal(x.band, 0)}"> to
        <input type="number" min="0" data-cmax placeholder="max" value="${bandVal(x.band, 1)}">
        <button class="ghost" data-regear="${i}" title="Re-optimize only this tower's gear for this range band">Re-gear</button></div>
      <div class="muted fxMsg"></div>`}
    </div>`;
  }).join('');
  $('fxLoadRow').hidden = !live.length;
}
function loadFantasy() {
  if (!fxLast?.length) return;
  if (team.some(Boolean) && !confirm('Replace your current Team with this fantasy team?')) return;
  team = [0, 1, 2, 3, 4].map((i) => (fxLast[i] ? { build: { ...fxLast[i].build, acc: [...fxLast[i].build.acc] }, tier: fxLast[i].tier, placements: fxLast[i].placements } : null));
  store.set('ttd.team', team);
  render();
  showView('team');
}

// ---------- compare towers ----------
// Raw, checkable stats only (everything here can be matched against the in-game stat screen):
// no scores, no tiers, no "how many enemies it hits" estimates.
const CMP_COLS = [
  { k: 'dps', label: 'DPS', d: 1, title: 'Stat-screen DPS: DMG ÷ SPA with crit and double attack (the number the game shows)' },
  { k: 'dmg', label: 'DMG', d: 1, title: 'Damage per hit (stat screen)' },
  { k: 'spa', label: 'SPA', d: 2, low: true, title: 'Seconds per attack (lower is faster)' },
  { k: 'rng', label: 'RNG', d: 1, title: 'Range' },
  { k: 'splash', label: 'Splash', d: 1, title: 'Splash radius as listed' },
  { k: 'chain', label: 'Chain', d: 0, title: 'Max Chain: bounces to the next enemy in line (never the same enemy twice); % = damage kept per bounce' },
  { k: 'pen', label: 'Pen', d: 0, title: 'Penetration: enemies a shot passes through' },
  { k: 'pl', label: 'Placements', d: 0, title: 'Max placements' },
  { k: 'cost', label: 'Cost', d: 0, low: true, title: 'Mana for one placement at this upgrade (placement + upgrades)' },
  { k: 'costAll', label: 'Cost × placements', d: 0, low: true, title: 'Mana for every placement at this upgrade' },
];
const CMP_SLIMED = { 'Slime Prince': 1, 'Slime Staff': 0 };   // applies Slimed (4s) from this upgrade on (Jolt)
let cmpTier = store.get('ttd.cmpTier', 'max');                 // 'max' or an upgrade number
let cmpGear = store.get('ttd.cmpGear', 'base');                // 'base' (no gear, no reforge) | 'best' (highest stat-screen DPS)
let cmpSort = store.get('ttd.cmpSort', { key: 'dps', dir: -1 });
let cmpRows = null;
const cmpTierOf = (u) => { const max = D.upgrades[u].length - 1; return cmpTier === 'max' ? max : Math.min(max, Number(cmpTier)); };
function cmpSpecials(u, s, tier) {
  const row = D.upgrades[u][tier] || {}, out = [];
  if (s.Globe > 0) out.push(`Globe ${fmt(s.Globe, 0)}`);
  if (s.percent > 0) out.push(`${fmt(s.percent, 0)}% max HP (≤100/hit)`);
  if (s.pellets > 1) out.push(`${s.pellets} pellets`);
  if (s.confusion > 0) out.push(`Confusion ${fmt(s.confusion, 0)}s`);
  if (Number(row['Bad Luck'])) out.push(`Bad Luck +${row['Bad Luck']}% crit`);
  if (CMP_SLIMED[u] != null && tier >= CMP_SLIMED[u]) out.push('Slimed 4s');
  if (s.retargetDelay > 0) out.push(`Lock-on (${s.retargetDelay}s re-target)`);
  if (INVERTED_RANGE_UNITS.has(u)) out.push('Reverse path');
  return out;
}
async function runCompare() {
  const units = Object.keys(D.units).filter((u) => D.upgrades[u]?.length && !NON_DAMAGING_UNITS.includes(u));
  // "Best gear" = the gear with the highest STAT-SCREEN DPS (no act, crowd or enemy model involved)
  const ctx = { key: 'cmp-screen|' + cmpTier + '|' + JSON.stringify(account), band: null, tierFor: cmpTierOf,
                dps: (b) => screenDPS(stats(b, {})) };
  const rows = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i], tier = cmpTierOf(u);
    if (cmpGear === 'best') { $('cmpStatus').textContent = `Finding the best gear for ${u} (${i + 1}/${units.length})…`; await fxPause(); }
    const b = cmpGear === 'best' ? { ...fxBestBuild(u, 'dps', ctx), tier: String(tier) }
      : { unit: u, tier: String(tier), level: 45, reforge: 'None', weapon: '', helmet: '', chest: '', boots: '',
          acc: Array(Number(D.units[u].accessory_slots) || 0).fill('') };
    const s = stats(b, {}), pl = Number(D.units[u].max_placements) || 1;
    rows.push({ unit: u, build: b, tier, maxTier: D.upgrades[u].length - 1,
                dps: screenDPS(s), dmg: s.DMG_screen, spa: s.SPA, rng: s.RNG, splash: s.Splash || 0,
                chain: s.chains > 1 ? s.chains : 0, preserve: s.preserve, pen: s.Pen || 0, pl,
                cost: s.cost, costAll: s.cost * pl, specials: cmpSpecials(u, s, tier) });
  }
  cmpRows = rows;
  $('cmpStatus').textContent = `${rows.length} towers · ${cmpTier === 'max' ? 'max upgrade' : `upgrade ${cmpTier} (or each tower's max, if lower)`} · ` +
    (cmpGear === 'best' ? 'best gear by stat-screen DPS (Lv 45)' : 'base stats: no gear, no reforge (Lv 45)');
  renderCompare();
}
function renderComparePickers() {
  const pill = (attr, v, t, on) => `<button data-${attr}="${v}" class="${on ? 'on' : ''}">${t}</button>`;
  $('cmpTierPick').innerHTML = [['max', 'Max upgrade'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]
    .map(([v, t]) => pill('tier', v, t, String(cmpTier) === v)).join('');
  $('cmpGearPick').innerHTML = [['base', 'Base'], ['best', 'Best gear']].map(([v, t]) => pill('gear', v, t, cmpGear === v)).join('');
}
function renderCompare() {
  renderComparePickers();
  if (!cmpRows) return;
  if (!CMP_COLS.some((c) => c.k === cmpSort.key)) cmpSort = { key: 'dps', dir: -1 };
  const { key, dir } = cmpSort;
  const rows = [...cmpRows].sort((a, b) => dir * (a[key] - b[key]) || b.dps - a.dps);
  const ico = (cat, n) => (n && ICONS[cat]?.[n] ? `<img class="ico" src="${encodeURI(ICONS[cat][n])}" alt="" title="${n}">` : '');
  const best = cmpGear === 'best';
  const cell = (r, c) => {
    if (c.k === 'chain') return r.chain ? `${r.chain} <span class="muted">${fmt(r.preserve * 100, 0)}%</span>` : '<span class="muted">—</span>';
    if ((c.k === 'splash' || c.k === 'pen') && !r[c.k]) return '<span class="muted">—</span>';
    return fmt(r[c.k], c.d);
  };
  $('cmpTable').innerHTML = '<tr><th style="text-align:left">Tower</th>' + (best ? '<th style="text-align:left">Gear</th>' : '') +
    CMP_COLS.map((c) => `<th data-sort="${c.k}" title="${c.title}" class="sortable${c.k === key ? ' on' : ''}">${c.label}${c.k === key ? (dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('') +
    '<th style="text-align:left">Specials</th></tr>' +
    rows.map((r) => `<tr>
      <td style="text-align:left;white-space:nowrap">${ico('units', r.unit)}${r.unit}<div class="muted">${r.build.reforge} · ${r.tier}/${r.maxTier}</div></td>
      ${best ? `<td class="gearCell" title="${fxGear(r.build).join(', ')}">${[ico('weapons', r.build.weapon), ico('armors', r.build.helmet), ico('armors', r.build.chest), ico('armors', r.build.boots), ...r.build.acc.map((a) => ico('accessories', a))].join('')}</td>` : ''}` +
      CMP_COLS.map((c) => `<td class="${c.k === key ? 'on' : ''}">${cell(r, c)}</td>`).join('') +
      `<td style="text-align:left" class="muted">${r.specials.join(' · ') || '—'}</td></tr>`).join('');
}

// ---------- banners ----------
// Banners the damage model uses keep their existing account keys (single source of truth for calc.js);
// every other banner is tracked in account.banners for collection / planning.
const BANNER_KEY = {
  'Sand Slime': 'sandSlime', 'Storm Hatchling': 'stormHatchling', 'Wandering Eye Fish': 'wanderingEyeFish',
  'Desert Scourge': 'desertScourge', 'Spiked Slime': 'spikedSlime', 'Patchwerk': 'patchwerk', 'Ice Bat': 'iceBat',
  'Undead Viking': 'undeadViking', 'King Slime': 'kingSlime', 'Eye of Cthulhu': 'eyeOfCthulhu',
  'Frozen Zombie': 'frozenZombie', 'Ice Slime': 'iceSlime', 'Cyan Beetle': 'cyanBeetle',
};
const bannerName = (r) => String(r.banner || '').replace(/\s*Banner$/, '');
const bannerOwned = (n) => (BANNER_KEY[n] ? !!account[BANNER_KEY[n]] : !!account.banners?.[n]);
function setBanner(n, on) {
  if (BANNER_KEY[n]) account[BANNER_KEY[n]] = on;
  else { account.banners ??= {}; if (on) account.banners[n] = true; else delete account.banners[n]; }
  store.set('ttd.account', account);
}
function renderBanners() {
  const all = D.banners || [];
  const q = ($('bannerSearch').value || '').trim().toLowerCase();
  const list = all.filter((r) => !q || bannerName(r).toLowerCase().includes(q) || String(r.effect).toLowerCase().includes(q));
  $('bannerGrid').innerHTML = list.map((r) => {
    const n = bannerName(r), on = bannerOwned(n), ic = ICONS.banners?.[n] || ICONS.enemies?.[n];   // real banner art, else the enemy sprite
    const effect = r.verified_effect || r.effect || '';
    return `<button type="button" class="bannerTile${on ? ' on' : ''}" data-banner="${n}" title="${on ? 'Owned' : 'Not owned'}">
      ${ic ? `<img src="${encodeURI(ic)}" alt="">` : '<span class="noimg"></span>'}
      <span class="bText"><span class="bName">${n}${BANNER_KEY[n] ? ' <span class="badge" title="Used by the damage model">⚔ DPS</span>' : ''}</span>
        <span class="bEffect">${effect}</span>
</span>
      <span class="bDot" aria-label="${on ? 'owned' : 'not owned'}"></span>
    </button>`;
  }).join('') || '<p class="muted">No banners match that search.</p>';
  const owned = all.filter((r) => bannerOwned(bannerName(r))).length;
  $('bannerCount').innerHTML = `<span style="width:${all.length ? (owned / all.length) * 100 : 0}%"></span><b>${owned}/${all.length} Banners</b>`;
}

// ---------- achievements ----------
// Boss Slayer / Pack a Punch feed calc.js through the existing account keys; everything else lives in account.ach
const ACH_KEY = { 'Boss Slayer': 'bossSlayer', 'Pack a Punch': 'packAPunch' };
const ACH_CATS = ['Slayer', 'Collector', 'Explorer', 'Challenger'];
const COMBAT_STATS = ['DMG', 'RNG', 'SPA', 'Penetration'];
const achTier = (name) => Number(ACH_KEY[name] ? account[ACH_KEY[name]] : account.ach?.[name]) || 0;
function setAchTier(name, t) {
  if (ACH_KEY[name]) account[ACH_KEY[name]] = t; else (account.ach ??= {})[name] = t;
  store.set('ttd.account', account);
}
function achGroups() {
  const g = new Map();
  for (const r of D.achievements || []) { if (!g.has(r.achievement)) g.set(r.achievement, []); g.get(r.achievement).push(r); }
  for (const rows of g.values()) rows.sort((a, b) => a.tier - b.tier);
  return g;
}
// pct/add tiers add up; 'x' tiers are shown compounding (the board doesn't say which — unverified)
function achBuff(r, n) {
  if (!n) return '—';
  if (r.buff_op === 'mult') return `×${fmt(r.buff_value ** n, 3)} ${r.buff_stat}`;
  return `+${fmt(r.buff_value * n, 2)}${r.buff_op === 'pct' ? '%' : ''} ${r.buff_stat}`;
}
function renderAchievements() {
  const g = achGroups();
  if (!g.size) { $('achList').innerHTML = '<p class="muted">No achievements.csv yet — run tools/parse_trello.py.</p>'; $('achStats').innerHTML = ''; return; }
  let tiers = 0, tiersDone = 0, plat = 0, platDone = 0, maxed = 0;
  for (const [name, rows] of g) {
    const n = Math.min(achTier(name), rows.length);
    tiers += rows.length; tiersDone += n; if (n === rows.length) maxed++;
    rows.forEach((r, i) => { plat += r.platinum; if (i < n) platDone += r.platinum; });
  }
  $('achStats').innerHTML =
    tile('Tiers completed', `${tiersDone} / ${tiers}`, `${fmt(tiersDone / tiers * 100, 0)}%`, true) +
    tile('Platinum earned', `${fmt(platDone, 0)} / ${fmt(plat, 0)}`, `${fmt(plat - platDone, 0)} left to claim`) +
    tile('Maxed achievements', `${maxed} / ${g.size}`, '');
  const cats = [...ACH_CATS, ...new Set([...g.values()].map((r) => r[0].category).filter((c) => !ACH_CATS.includes(c)))];
  $('achList').innerHTML = cats.map((cat) => {
    const list = [...g].filter(([, rows]) => rows[0].category === cat);
    if (!list.length) return '';
    return `<h3 class="achCat">${cat}</h3><div class="achGrid">` + list.map(([name, rows]) => {
      const r0 = rows[0], n = Math.min(achTier(name), rows.length), combat = COMBAT_STATS.includes(r0.buff_stat);
      const pips = rows.map((r, i) => `<button class="pip${i < n ? ' on' : ''}" data-ach="${name}" data-t="${i + 1}" title="Tier ${i + 1}">${i + 1}</button>`).join('');
      const tasks = rows.map((r, i) => `<li class="${i < n ? 'done' : ''}"><span class="chk">${i < n ? '✓' : '○'}</span>${r.task}<span class="pt">${r.platinum} Pt</span></li>`).join('');
      const icon = ICONS.achievements?.[name];
      return `<div class="ach${n === rows.length ? ' maxed' : ''}">
        <div class="achTop">
          ${icon ? `<img class="achIcon" src="${encodeURI(icon)}" alt="">` : '<span class="achIcon placeholder"></span>'}
          <div class="achMain">
            <div class="achHead"><span class="name">${name}</span>${combat ? '<span class="badge" title="Used by the damage model">⚔ DPS</span>' : ''}</div>
            <div class="pips">${pips}</div>
          </div>
        </div>
        <div class="muted">${r0.buff_text} per tier</div>
        <ol class="tasks">${tasks}</ol>
        <div class="achTot">Now: <b>${achBuff(r0, n)}</b>${n < rows.length ? ` · maxed: ${achBuff(r0, rows.length)}` : ''}</div>
      </div>`;
    }).join('') + '</div>';
  }).join('');
}
function onAchClick(ev) {
  const b = ev.target.closest('button[data-ach]'); if (!b) return;
  const name = b.dataset.ach, t = Number(b.dataset.t);
  setAchTier(name, achTier(name) === t ? t - 1 : t);
  renderAchievements();
  render();
}

function saveBuildToTeam() {
  const i = Number($('teamSlotPick').value);
  const replaced = team[i]?.build?.unit;
  if (!setTeamSlot(i)) return;
  store.set('ttd.team', team);
  $('saveToTeamMsg').textContent = `Saved to slot ${i + 1}${replaced ? ` (replaced ${replaced})` : ''}`;
  $('teamSlotPick').value = '';
  render();
}

// Team palette: gold = team total; the rest are tuned to sit well on the indigo theme (no pure white)
const COLORS = ['#ffd93d', '#7fe3ff', '#6cf06a', '#ff8fb1', '#c3a6ff', '#ffa45c', '#9fb4ff'];
const CHART_EXCLUDED_UNITS = new Set(['Merchant', 'Star Merchant']);

const teamDefense = () => clampTeamDefense($('teamDef')?.value);
const teamFight = (f) => ({ ...f, enemy: { ...f.enemy, DEF: teamDefense() } });
function chartSeries(cur, f) {
  const members = teamMembers().filter((m) => !CHART_EXCLUDED_UNITS.has(m.b.unit));
  const per = members.map((m, k) => {
    const st = stats(m.b, f.fight);
    return { label: `${m.b.unit} ×${m.t.placements}`, unit: m.b.unit, slot: m.slot, s: [st], color: COLORS[(k + 1) % COLORS.length], width: 2.25,
             fns: [(d) => realDPS(st, { ...f.enemy, DEF: d }, f.opts) * m.t.placements] };
  });
  if (!per.length) return [];
  const total = { label: 'Team total', total: true, color: COLORS[0], width: 4, s: per.flatMap((p) => p.s), fns: per.flatMap((p) => p.fns) };
  return [total, ...per];
}
// "Nice" axis step: 1 / 2 / 2.5 / 5 × 10^n
function niceStep(max, ticks = 5) {
  const raw = max / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
let chartCache = null, chartHover = null;   // computed lines + layout, reused for hover redraws
function drawChart(cur, f) {
  const cv = $('chart');
  const tf = teamFight(f), series = chartSeries(cur, tf);
  const W = Math.max(320, cv.clientWidth || cv.parentElement.clientWidth - 40), H = Math.round(Math.min(480, Math.max(300, W * 0.44)));
  if (!series.length) { chartCache = { empty: true, W, H }; paintChart(); $('legend').innerHTML = ''; return; }
  const at = (x, d) => x.fns.reduce((t, fn) => t + fn(d), 0);
  const wantedDef = teamDefense();
  const minDef = TEAM_DEF_MIN, capDef = TEAM_DEF_MAX, xStep = 5;
  const step = (capDef - minDef) / 320;
  const pts = series.map((x) => { const a = []; for (let d = minDef; d <= capDef + 1e-9; d += step) a.push([d, at(x, d)]); return a; });
  const peak = Math.max(1, ...pts.flat().map((p) => p[1]));
  const yStep = niceStep(peak * 1.05), maxY = Math.ceil(peak * 1.05 / yStep) * yStep;
  const markers = wantedDef === 0
    ? [{ d: 0, color: '#ffd93d', label: 'DEF 0 · selected', zero: true }]
    : [
        { d: 0, color: '#dfe4ff', label: 'DEF 0', zero: true },
        { d: wantedDef, color: '#ff7676', label: `Selected DEF ${fmt(wantedDef, 0)}` },
      ];
  chartCache = { W, H, series, pts, minDef, capDef, xStep, maxY, yStep, markers, step };
  paintChart();
  const icon = (n) => (n && ICONS.units?.[n] ? `<img class="ico" src="${encodeURI(ICONS.units[n])}" alt="">` : '');
  $('legend').innerHTML = series.map((x) => `<span class="${x.total ? 'total' : ''}" style="--c:${x.color}">${icon(x.unit)}${x.label}</span>`).join('');
}
function paintChart() {
  const C = chartCache; if (!C) return;
  const cv = $('chart'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1, { W, H } = C;   // draw at real pixel density: crisp lines and text
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--chart-text').trim() || '#c9d1ff';
  const font = (w, s) => `${w} ${s}px "Terraria Andy", Andy, cursive`;
  const pad = { l: 62, r: 22, t: 34, b: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  // plot panel
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const bg = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
  bg.addColorStop(0, '#1c235c'); bg.addColorStop(1, '#141a48');
  rr(pad.l, pad.t, pw, ph, 10); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(120,140,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
  if (C.empty) {
    ctx.fillStyle = txt; ctx.font = font(600, 15); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Add towers to your Team to see the chart', pad.l + pw / 2, pad.t + ph / 2); return;
  }
  const X = (d) => pad.l + ((d - C.minDef) / (C.capDef - C.minDef)) * pw, Y = (v) => pad.t + ph - (v / C.maxY) * ph;
  // grid + axis labels
  ctx.save(); rr(pad.l, pad.t, pw, ph, 10); ctx.clip();
  ctx.strokeStyle = 'rgba(160,175,255,.09)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
  for (let v = C.yStep; v < C.maxY - 1e-9; v += C.yStep) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + pw, Y(v)); ctx.stroke(); }
  for (let d = C.minDef + C.xStep; d < C.capDef - 1e-9; d += C.xStep) {
    if (d === 0) continue;
    ctx.beginPath(); ctx.moveTo(X(d), pad.t); ctx.lineTo(X(d), pad.t + ph); ctx.stroke();
  }
  ctx.setLineDash([]);
  // area under the team total
  const tot = C.pts[0], grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
  grad.addColorStop(0, 'rgba(255,217,61,.28)'); grad.addColorStop(1, 'rgba(255,217,61,0)');
  ctx.beginPath(); ctx.moveTo(X(tot[0][0]), Y(0)); tot.forEach(([d, v]) => ctx.lineTo(X(d), Y(v))); ctx.lineTo(X(tot[tot.length - 1][0]), Y(0)); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // markers
  for (const m of C.markers) {
    if (m.d > C.capDef) continue;
    ctx.strokeStyle = m.color; ctx.globalAlpha = m.zero ? .9 : .82; ctx.lineWidth = m.zero ? 2 : 1.5; ctx.setLineDash(m.zero ? [] : [5, 5]);
    ctx.beginPath(); ctx.moveTo(X(m.d), pad.t); ctx.lineTo(X(m.d), pad.t + ph); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // lines: towers first, team total last (on top, with a soft glow)
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = C.pts.length - 1; i >= 0; i--) {
    const s = C.series[i];
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
    if (s.total) { ctx.shadowColor = 'rgba(255,217,61,.55)'; ctx.shadowBlur = 10; }
    ctx.beginPath(); C.pts[i].forEach(([d, v], j) => (j ? ctx.lineTo(X(d), Y(v)) : ctx.moveTo(X(d), Y(v)))); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  // marker pills above the plot
  ctx.font = font(700, 11); ctx.textBaseline = 'middle';
  let lastRight = -Infinity;
  for (const m of [...C.markers].sort((a, b) => a.d - b.d)) {
    if (m.d > C.capDef) continue;
    const w = ctx.measureText(m.label).width + 14, x = Math.min(Math.max(X(m.d) - w / 2, pad.l, lastRight + 6), pad.l + pw - w);
    rr(x, pad.t - 24, w, 18, 9); ctx.fillStyle = m.color; ctx.fill();
    ctx.fillStyle = '#141a48'; ctx.textAlign = 'left'; ctx.fillText(m.label, x + 7, pad.t - 15);
    lastRight = x + w;
  }
  // axes text
  ctx.fillStyle = txt; ctx.font = font(500, 12);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= C.maxY + 1e-9; v += C.yStep) ctx.fillText(fmt(v, 0), pad.l - 10, Y(v));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let d = C.minDef; d <= C.capDef + 1e-9; d += C.xStep) ctx.fillText(fmt(d, d % 1 ? 1 : 0), X(d), pad.t + ph + 8);
  ctx.font = font(700, 12); ctx.fillStyle = '#e6eaff';
  ctx.fillText('Enemy DEF', pad.l + pw / 2, pad.t + ph + 30);
  ctx.save(); ctx.translate(18, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText('DPS', 0, 0); ctx.restore();
  // hover: crosshair + tooltip with every line's DPS at that DEF
  if (chartHover != null && chartHover >= C.minDef && chartHover <= C.capDef) {
    const i = Math.round((chartHover - C.minDef) / C.step), d = C.pts[0][Math.min(i, C.pts[0].length - 1)][0], x = X(d);
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    const rows = C.series.map((s, k) => ({ s, v: C.pts[k][Math.min(i, C.pts[k].length - 1)][1] }));
    for (const r of rows) { ctx.beginPath(); ctx.arc(x, Y(r.v), r.s.total ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fillStyle = r.s.color; ctx.fill();
      ctx.strokeStyle = '#141a48'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.font = font(600, 12);
    const lines = [`DEF ${fmt(d, 0)}`, ...rows.map((r) => `${r.s.label}: ${fmt(r.v, 2)} DPS`)];
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 34, th = lines.length * 18 + 12;
    let tx = x + 12; if (tx + tw > pad.l + pw) tx = x - 12 - tw;
    const ty = pad.t + 8;
    rr(tx, ty, tw, th, 8); ctx.fillStyle = 'rgba(14,18,52,.94)'; ctx.fill(); ctx.strokeStyle = 'rgba(120,140,255,.5)'; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach((l, k) => {
      const yy = ty + 15 + k * 18;
      if (k) { ctx.fillStyle = rows[k - 1].s.color; ctx.fillRect(tx + 10, yy - 2, 12, 4); }
      ctx.fillStyle = k ? '#ffffff' : '#ffd93d'; ctx.fillText(l, tx + (k ? 28 : 10), yy);
    });
  }
}
init();

// ---------- team (5 slots) ----------
function refreshLoadouts(select) {
  const names = Object.keys(loadouts).sort();
  opts($('loadoutPick'), names, names.length ? undefined : '— no saved loadouts —');
  if (select) $('loadoutPick').value = select;
}
function onTeamClick(ev) {
  const btn = ev.target.closest('button[data-act]'); if (!btn) return;
  const i = Number(btn.dataset.slot), act = btn.dataset.act;
  if (act === 'set' && !setTeamSlot(i)) return; else if (act === 'edit' && team[i]) {
    const b = team[i].build;
    $('unit').value = b.unit; onUnitChange({ ...b, tier: String(team[i].tier) });
    showView('build');
  } else if (act === 'clear') team[i] = null;
  store.set('ttd.team', team);
  render();
}
function onTeamSlider(ev) {
  const el = ev.target; if (!el.dataset.slot) return;
  const t = team[Number(el.dataset.slot)]; if (!t) return;
  t[el.dataset.kind] = Number(el.value);
  store.set('ttd.team', team);
  // update the label live; full recalculation happens on release ('change') so dragging stays smooth
  const lab = el.parentElement.firstChild;
  lab.textContent = lab.textContent.replace(/\d+\//, `${el.value}/`);
  ev.stopPropagation();
}
function slotDPS(t, f, mix) {
  const b = { ...t.build, tier: String(t.tier) };
  if (mix) return actDPS(b, mix, f);
  return realDPS(stats(b, f.fight), f.enemy, f.opts);
}
function renderTeam(f) {
  const tf = teamFight(f), targetDef = teamDefense();
  let totDps = 0, totMana = 0, totPl = 0;
  const cards = team.map((t, i) => {
    if (!t || !D.units[t.build.unit]) {
      return `<div class="slot empty teamEmpty">
        <button class="emptySlotAdd" data-act="set" data-slot="${i}" aria-label="Add the current Build to team slot ${i + 1}">
          <span class="emptySlotPlus" aria-hidden="true">+</span>
          <span class="emptySlotLabel">Add tower</span>
          <span class="emptySlotNote">Slot ${i + 1} · uses current Build</span>
        </button>
      </div>`;
    }
    const u = D.units[t.build.unit], rows = D.upgrades[t.build.unit];
    const maxTier = rows.length - 1, maxPl = Number(u.max_placements) || 1;
    t.tier = Math.min(t.tier, maxTier); t.placements = Math.min(t.placements, maxPl);
    const b = { ...t.build, tier: String(t.tier) };
    const attacking = !CHART_EXCLUDED_UNITS.has(t.build.unit);
    const per = attacking ? slotDPS(t, tf, null) : 0, st = stats(b, {});
    const dps = per * t.placements, mana = st.cost * t.placements;
    totDps += dps; totMana += mana; totPl += t.placements;
    const g = t.build;
    return `<div class="slot reforgeCard towerBackdrop" style="${towerCardStyle(g.unit)}">
      ${towerCardVisual(g, u.can_level === 'no' ? 1 : g.level)}
      <label>Upgrade ${t.tier}/${maxTier}<input type="range" min="0" max="${maxTier}" value="${t.tier}" data-slot="${i}" data-kind="tier"></label>
      <label>Placements ${t.placements}/${maxPl}<input type="range" min="0" max="${maxPl}" value="${t.placements}" data-slot="${i}" data-kind="placements"></label>
      <div class="dps">${attacking ? `${fmt(dps)} DPS` : 'Economy / support'}</div>
      <div class="muted">${attacking ? `${fmt(per)} each · ` : ''}${fmt(mana, 0)} mana</div>
      <div class="btns"><button class="ghost" data-act="edit" data-slot="${i}">Edit</button>
        <button class="ghost" data-act="set" data-slot="${i}">Set from Build</button>
        <button class="danger" data-act="clear" data-slot="${i}">Clear</button></div>
    </div>`;
  });
  $('teamSlots').innerHTML = cards.join('');
  refreshTeamSlotPick();
  $('teamStats').innerHTML =
    tile('Attacking Team DPS', fmt(totDps), `vs Enemy DEF ${targetDef}`, true) +
    tile('Total mana', fmt(totMana, 0), `${totPl} placements`) +
    tile('DPS / 1k mana', totMana ? fmt(totDps / totMana * 1000, 2) : '—', 'cost efficiency');
}

// ---------- loadout optimizer ----------
// Items that can't be worn together (from the Trello item notes)
const CONFLICTS = [['Ancient Chisel', 'Lucky Horseshoe'], ['Frostburn Arrow', 'Flaming Arrow']];
// "can only be equipped on X" restrictions, read from item notes/descriptions
// Explicit unit restrictions (verified by Jolt); these win over the note-parsing fallback below.
const ECO_UNITS = ['Merchant', 'Star Merchant'];
const NON_DAMAGING_UNITS = [...ECO_UNITS, 'Squashling'];
const ITEM_RESTRICTIONS = {
  'Mandible Blade': (u) => !NON_DAMAGING_UNITS.includes(u),   // attacking units only
  'Ice Skates': (u) => !ECO_UNITS.includes(u),                // not on eco units
  'Falcon Blade': (u) => u === 'Dye Trader',
  'Bomb': (u) => u === 'Demolitionist',
  'Freeze Bomb': (u) => u === 'Demolitionist',
};
// Not on eco units: Balloon Pufferfish + every Double Attack accessory (named, plus any row with a Double Attack stat)
const NO_ECO_ITEMS = ['Balloon Pufferfish', 'Cloud in a Bottle', 'Sandstorm in a Bottle', 'Blizzard in a Bottle', 'Tsunami in a Bottle'];
function allowedFor(row, unit) {
  if (ECO_UNITS.includes(unit) && (NO_ECO_ITEMS.includes(row.name) || Number(row['Double Attack (pct)']) > 0)) return false;
  if (ITEM_RESTRICTIONS[row.name]) return ITEM_RESTRICTIONS[row.name](unit);
  const t = `${row.notes || ''} ${row.description || ''}`;
  const m = t.match(/only be equipped (?:on|onto) (?:the )?([A-Z][A-Za-z' ]+?)(?:[."]|$)/);
  return !m || m[1].trim() === unit;
}
let lastOpt = [];
function runOptimizer() {
  const base = currentBuild(), f = fightOpts(), mix = actMix();
  const unit = base.unit, scope = $('optScope').value;
  const names = (rows) => rows.filter((r) => allowedFor(r, unit) && !excluded.includes(r.name)).map((r) => r.name);
  const armor = (part) => names(D.armors.filter((a) => a.group.endsWith(part)));
  const accNames = names(D.accessories);
  const slots = [];
  if (scope === 'all') {
    slots.push({ key: 'weapon', options: ['', ...names(D.weapons)] },
               { key: 'helmet', options: ['', ...armor('Helmet')] },
               { key: 'chest', options: ['', ...armor('Chestplate')] },
               { key: 'boots', options: ['', ...armor('Boots')] });
  }
  base.acc.forEach((_, i) => slots.push({ key: 'acc' + i, group: 'acc', options: ['', ...accNames] }));

  const toBuild = (L) => ({
    ...base,
    ...(scope === 'all' ? { weapon: L.weapon, helmet: L.helmet, chest: L.chest, boots: L.boots } : {}),
    acc: base.acc.map((_, i) => L['acc' + i] || ''),
  });
  const evaluate = (L) => {
    const b = toBuild(L);
    const dps = mix && mix.length ? actDPS(b, mix, f) : realDPS(stats(b, f.fight), f.enemy, f.opts);
    const st = stats(b, {});
    return { dps, rng: st.RNG, cost: st.cost, luck: st.luck };
  };
  const start = { weapon: base.weapon, helmet: base.helmet, chest: base.chest, boots: base.boots };
  base.acc.forEach((a, i) => { start['acc' + i] = a; });

  $('optStatus').textContent = 'Searching…';
  $('optRun').disabled = true;
  setTimeout(() => {   // let the "Searching…" text paint first
    const t0 = performance.now();
    const res = optimize({ slots, start, evaluate, mode: $('optMode').value,
                           minRng: Number($('optMinRng').value) || 0, rules: { conflicts: CONFLICTS }, top: 25 });
    // the starting (current) loadout may contain excluded gear: never recommend those
    res.results = res.results.filter((r) => !Object.values(r.loadout).some((n) => n && excluded.includes(n))).slice(0, 5);
    lastOpt = res.results.map((r) => toBuild(r.loadout));
    const vs = mix && mix.length ? `${$('act').value} (${$('diff').value})` : ($('enemy').value || 'custom enemy');
    $('optStatus').textContent = `${res.evaluated.toLocaleString()} loadouts checked in ${fmt((performance.now() - t0) / 1000, 1)}s · vs ${vs}`;
    $('optRun').disabled = false;
    const ico = (cat, name) => ICONS[cat]?.[name] ? `<img class="ico" src="${encodeURI(ICONS[cat][name])}" alt="" title="${name}">` : '';
    const gear = (b) => [ico('weapons', b.weapon), ico('armors', b.helmet), ico('armors', b.chest), ico('armors', b.boots),
                         ...b.acc.map((a) => ico('accessories', a))].join('');
    const names = (b) => [b.weapon, b.helmet, b.chest, b.boots, ...b.acc].filter(Boolean).join(', ') || 'nothing';
    const cur = res.current;
    const row = (r, label, b, i) => {
      const dd = (r.dps / cur.dps - 1) * 100, dr = r.rng - cur.rng;
      return `<tr class="${i === undefined ? 'cur' : ''}"><td>${label}</td><td style="text-align:left">${gear(b)}<div class="muted">${names(b)}</div></td>
        <td>${fmt(r.dps)}${i === undefined ? '' : ` <span class="${dd > 0.05 ? 'up' : dd < -0.05 ? 'down' : ''}">${dd >= 0 ? '+' : ''}${fmt(dd, 1)}%</span>`}</td>
        <td>${fmt(r.rng, 1)}${i === undefined ? '' : ` <span class="${dr > 0.05 ? 'up' : dr < -0.05 ? 'down' : ''}">${dr >= 0 ? '+' : ''}${fmt(dr, 1)}</span>`}</td>
        <td>${fmt(r.cost, 0)}</td><td>${fmt(r.dps / r.cost * 1000, 2)}</td><td>×${fmt(r.luck ?? 1, 2)}</td>
        <td>${i === undefined ? '' : `<button class="primary" data-apply="${i}">Apply</button>`}</td></tr>`;
    };
    $('optTable').innerHTML = '<tr><th>#</th><th style="text-align:left">Loadout</th><th>DPS</th><th>RNG</th><th>Mana</th><th>DPS / 1k mana</th><th title="Drop luck on the enemies this unit kills">Luck</th><th></th></tr>' +
      row(cur, 'Now', toBuild(cur.loadout)) +
      res.results.map((r, i) => r.ok ? row(r, i + 1, lastOpt[i], i) : '').join('') +
      (res.results.some((r) => r.ok) ? '' : '<tr><td colspan="8" class="muted">No loadout reaches that Min RNG.</td></tr>');
  }, 30);
}
function applyOptimized(ev) {
  const btn = ev.target.closest('button[data-apply]'); if (!btn) return;
  const b = lastOpt[Number(btn.dataset.apply)]; if (!b) return;
  for (const k of ['weapon', 'helmet', 'chest', 'boots']) $(k).value = b[k] || '';
  document.querySelectorAll('.acc').forEach((s, i) => { s.value = b.acc[i] || ''; });
  render();
  showView('build');
}

function chipsHTML(list, empty, title) {
  const cat = (n) => D.weapons.some((r) => r.name === n) ? 'weapons' : D.armors.some((r) => r.name === n) ? 'armors' : 'accessories';
  return list.length
    ? list.map((n) => `<span class="chip">${ICONS[cat(n)]?.[n] ? `<img src="${encodeURI(ICONS[cat(n)][n])}" alt="">` : ''}${n}<button data-un="${n}" title="${title}">×</button></span>`).join('')
    : `<span class="muted">${empty}</span>`;
}
function renderExcluded() {   // one list, shown in both the Build optimizer and Fantasy Teams
  $('exclChips').innerHTML = chipsHTML(excluded, 'Nothing excluded.', 'Allow again');
  if ($('fxExclChips')) $('fxExclChips').innerHTML = chipsHTML(excluded, 'Nothing excluded — every item counts as owned.', 'Allow again');
}
// wire an "type a name + button" editor to a list
function wireItemList(inputId, addId, chipsId, getList, setList, storeKey) {
  const add = () => {
    const v = $(inputId).value.trim();
    const real = [...D.weapons, ...D.armors, ...D.accessories].find((r) => r.name.toLowerCase() === v.toLowerCase());
    if (real && !getList().includes(real.name)) { setList([...getList(), real.name]); store.set(storeKey, getList()); }
    $(inputId).value = ''; renderExcluded();
  };
  $(addId).onclick = add;
  $(inputId).addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $(chipsId).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-un]'); if (!b) return;
    setList(getList().filter((n) => n !== b.dataset.un)); store.set(storeKey, getList()); renderExcluded();
  });
}

// ---------- mana planner ----------
// Greedy plan: repeatedly buy the step (place a copy / upgrade a copy by 1+ tiers) with the best
// extra-DPS-per-mana, up to the Team's targets. Looking ahead over multi-tier upgrades stops it from
// ignoring a tier that's weak alone but unlocks a strong one.
function planSteps(f, mix) {
  const tiersCache = {}, incomeCache = {};
  const dpsAt = (slot, tier) => {
    const k = slot.i + ':' + tier;
    if (!(k in tiersCache)) tiersCache[k] = ECO_UNITS.includes(slot.t.build.unit) ? 0 : slotDPS({ ...slot.t, tier }, f, mix);
    return tiersCache[k];
  };
  const incomeAt = (slot, tier) => {
    const k = slot.i + ':' + tier;
    if (!(k in incomeCache)) {
      if (!ECO_UNITS.includes(slot.t.build.unit)) incomeCache[k] = 0;
      else {
        const s = stats({ ...slot.t.build, tier: String(tier) }, {});
        incomeCache[k] = s.DMG / s.SPA;
      }
    }
    return incomeCache[k];
  };
  const scoreAt = (slot, tier) => ECO_UNITS.includes(slot.t.build.unit) ? incomeAt(slot, tier) : dpsAt(slot, tier);
  const slots = team.map((t, i) => ({ t, i })).filter(({ t }) => t && D.units[t.build.unit] && t.placements > 0);
  const copies = [];      // { slot, tier } for each placed copy
  const placed = {};      // slot index -> count
  const steps = [];
  for (let guard = 0; guard < 400; guard++) {
    let best = null;
    for (const sl of slots) {
      const rows = D.upgrades[sl.t.build.unit];
      const st = stats({ ...sl.t.build, tier: '0' }, {});
      const placeCost = rows[0].tier_cost * st.placementCostMult;
      // place another copy (it starts at tier 0)
      if ((placed[sl.i] || 0) < sl.t.placements) {
        const dpsGain = dpsAt(sl, 0), manaGain = incomeAt(sl, 0);
        cand({ kind: 'place', sl, cost: placeCost, dpsGain, manaGain, scoreGain: scoreAt(sl, 0), to: 0 });
      }
      // Score with multi-tier look-ahead, but buy only the next tier so every upgrade appears in the plan.
      const c = copies.filter((x) => x.slot === sl.i).sort((a, b) => a.tier - b.tier)[0];
      const targetTier = Math.min(Number(sl.t.tier) || 0, rows.length - 1);
      if (c && c.tier < targetTier) {
        const next = c.tier + 1;
        let lookCost = 0, scoreRatio = -Infinity;
        for (let to = next; to <= targetTier; to++) {
          lookCost += rows[to].tier_cost * st.upgradeCostMult;
          scoreRatio = Math.max(scoreRatio, (scoreAt(sl, to) - scoreAt(sl, c.tier)) / lookCost);
        }
        cand({ kind: 'upgrade', sl, copy: c, cost: rows[next].tier_cost * st.upgradeCostMult,
          dpsGain: dpsAt(sl, next) - dpsAt(sl, c.tier), manaGain: incomeAt(sl, next) - incomeAt(sl, c.tier),
          scoreRatio, to: next });
      }
    }
    function cand(x) {
      x.ratio = x.scoreRatio ?? (x.scoreGain / x.cost);
      if (!best || x.ratio > best.ratio || (x.ratio === best.ratio && x.cost < best.cost)) best = x;
    }
    if (!best) break;
    if (best.kind === 'place') { copies.push({ slot: best.sl.i, tier: 0 }); placed[best.sl.i] = (placed[best.sl.i] || 0) + 1; }
    else best.copy.tier = best.to;
    steps.push(best);
  }
  return steps;
}
function renderPlan(f) {
  const mix = actMix();
  const ico = (cat, name) => ICONS[cat]?.[name] ? `<img class="ico" src="${encodeURI(ICONS[cat][name])}" alt="">` : '';
  const steps = planSteps(f, mix && mix.length ? mix : null);
  if (!steps.length) {
    $('planStats').innerHTML = '<p class="muted">Add towers to your Team to get a plan.</p>';
    $('planOrder').innerHTML = ''; return;
  }
  const start = Number($('planStart').value) || 0;
  let cum = 0, dps = 0, manaPerSec = 0;
  const rows = steps.map((x, n) => {
    cum += x.cost; dps += x.dpsGain; manaPerSec += x.manaGain;
    return { ...x, n: n + 1, cum, dps, manaPerSec };
  });
  const affordable = rows.filter((r) => r.cum <= start);
  $('planOrder').innerHTML = '<tr><th>#</th><th>Buy</th><th>Mana</th><th>Total spent</th><th>Team DPS</th><th>Mana/s</th></tr>' +
    rows.map((r) => `<tr class="${r.cum <= start ? 'cur' : ''}"><td>${r.n}</td><td class="left">${ico('units', r.sl.t.build.unit)}${r.kind === 'place' ? 'Place' : 'Upgrade'} ${r.sl.t.build.unit}${r.kind === 'upgrade' ? ` → ${r.to}` : ''}</td><td>${fmt(r.cost, 0)}</td><td>${fmt(r.cum, 0)}</td><td>${fmt(r.dps)}</td><td>${fmt(r.manaPerSec, 2)}</td></tr>`).join('');

  const full = rows[rows.length - 1];
  $('planStats').innerHTML =
    tile('Affordable at start', `${affordable.length} buys`, affordable.length
      ? `${fmt(affordable[affordable.length - 1].dps)} team DPS · ${fmt(affordable[affordable.length - 1].manaPerSec, 2)} mana/s`
      : '0 team DPS · 0 mana/s', true) +
    tile('Full Team costs', fmt(full.cum, 0), `${fmt(full.dps)} team DPS · ${fmt(full.manaPerSec, 2)} mana/s`);
}

// ---------- sidebar navigation: one view at a time ----------
const VIEWS = [
  { id: 'build', label: 'Build', sections: ['build', 'fight', 'results', 'optCard'], icon: ['weapons', 'Copper Shortsword'] },
  { id: 'team', label: 'Team & Defense', sections: ['teamCard'], icon: ['units', 'Guide'] },
  { id: 'compare', label: 'Compare Towers', sections: ['compareCard'], icon: ['consumables', 'Golden Crate'] },
  { id: 'fantasy', label: 'Fantasy Teams', sections: ['fantasyCard'], icon: ['accessories', 'Gold Crown'] },
  { id: 'act', label: 'Act Analysis', sections: ['actCard'], icon: ['enemies', 'Eye of Cthulhu'] },
  { id: 'plan', label: 'Mana Planner', sections: ['planCard'], icon: ['consumables', 'Mana Crystal'] },
  { id: 'acct', label: 'Account Buffs', sections: ['acctCard', 'bannerCard'], icon: ['consumables', 'Seafood Dinner'] },
  { id: 'ach', label: 'Achievements', sections: ['achCard'], icon: ['accessories', 'Platinum Crown'] },
];
let activeViewId = null;
function buildNav() {
  const nav = document.createElement('nav'); nav.id = 'side';
  nav.innerHTML = VIEWS.map((v) => {
    const path = ICONS[v.icon[0]]?.[v.icon[1]];
    return `<button data-view="${v.id}">${path ? `<img src="${encodeURI(path)}" alt="">` : '<span class="dot"></span>'}<span>${v.label}</span></button>`;
  }).join('');
  document.body.prepend(nav);
  document.body.classList.add('withnav');
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view); });
  showView(store.get('ttd.view', 'build'));
}
function showView(id) {
  if (id === 'rank') id = 'compare';   // Towers Ranked became Compare Towers
  if (id === 'chart') id = 'team';     // Defense chart is now part of Team & Defense
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  const changed = activeViewId !== v.id;
  activeViewId = v.id;
  for (const x of VIEWS) for (const sid of x.sections) { const el = $(sid); if (el) el.hidden = x !== v; }
  if (changed) {
    const visible = v.sections.map((sid) => $(sid)).filter(Boolean);
    visible.forEach((el) => el.classList.remove('viewEntering'));
    requestAnimationFrame(() => visible.forEach((el, i) => {
      el.style.setProperty('--enter-delay', `${i * 22}ms`);
      el.classList.add('viewEntering');
      el.addEventListener('animationend', () => el.classList.remove('viewEntering'), { once: true });
    }));
  }
  document.querySelectorAll('#side button').forEach((b) => b.classList.toggle('on', b.dataset.view === v.id));
  store.set('ttd.view', v.id);
  if (v.id === 'team' && appReady) render();   // size the chart after its combined view becomes visible
  if (v.id === 'compare' && appReady && !cmpRows) runCompare();   // fill the table on first open
  window.scrollTo({ top: 0 });
}

// ---------- biome background ----------
// Layer 1: the picture for the picked act's biome. Layer 2: the dark-blue shade on top at 10%.
const BG_SHADE = 0.10;
function applyBackground() {
  const parts = ($('act').value || 'Forest Act 1').split(' ');
  const biome = parts[0].toLowerCase(), act = Number(parts[2]) || 1;
  const list = BGS[biome] || BGS.forest || [];
  // Forest Acts 4-6 (and Blood Moon) are at night: use the 2nd forest picture there
  const url = list[biome === 'forest' && act >= 4 && list[1] ? 1 : 0] || null;
  document.body.style.setProperty('--bg-img', url ? `url("${encodeURI(url)}")` : 'none');
  document.body.style.setProperty('--bg-shade', url ? BG_SHADE : 1);
}
