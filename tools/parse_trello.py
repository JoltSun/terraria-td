"""Parse the Terraria TD Remastered Trello JSON export into clean CSVs.

Usage:  python parse_trello.py board.json out_dir/

Outputs
  accessories.csv / weapons.csv / armors.csv / whips.csv   (one row per item, wide stat columns)
  item_effects.csv      long format: item, category, stat, op, value   <- best input for a calculator
  units.csv             base stats per unit
  unit_upgrades.csv     one row per upgrade tier (tier 0 = base)
  enemies.csv           bestiary stats
  banners.csv           kill-milestone banners (deduped)
  permanent_buffs.csv   account-wide consumables (Seafood Dinner etc.)
  achievements.csv      one row per achievement tier: task, Platinum reward, per-tier buff

Stat ops:  mult = "1.02x DMG"   add = "+1 DMG"   pct = "+15% Crit Chance"   max = "3 Max Splash"
Anything a regex can't turn into a number goes to `special` (text) so nothing is lost.
"""
import csv, json, os, re, sys
from collections import defaultdict

LINK = re.compile(r'\[([^\]]*)\]\([^)]*\)')
def clean(s):
    s = LINK.sub(r'\1', s)
    s = s.replace('‌', '').replace('“', '"').replace('”', '"').replace('’', "'")
    return re.sub(r'\s+', ' ', s).strip(' -')

def sections(desc):
    """Split a card description into {'Stats': [lines], ...} keyed by **Header:**."""
    out, cur = defaultdict(list), None
    for line in desc.split('\n'):
        h = re.match(r'\s*(?:\*\*)?([A-Z][^*:\n]{1,30}):(?:\*\*)?\s*(?:_.*_)?\s*$', line)
        if h:
            cur = h.group(1).strip(); continue
        if cur and line.strip().startswith('-'):
            indent = len(line) - len(line.lstrip())
            out[cur].append((indent, line.strip()[1:].strip()))
    return out

STAT_ALIASES = {'Spash': 'Splash', 'Criti Damage': 'Crit Damage'}
def norm_stat(s):
    s = s.strip().rstrip('.')
    return STAT_ALIASES.get(s, s)

PATTERNS = [
    (re.compile(r'^([\d.]+)x ([A-Za-z][\w ]*)$'), 'mult'),
    (re.compile(r'^([+-][\d.]+)% ([A-Za-z][\w ]*)$'), 'pct'),
    (re.compile(r'^([+-][\d.]+) ([A-Za-z][\w ]*)$'), 'add'),
    (re.compile(r'^([\d.]+) Max ([A-Za-z][\w ]*)$'), 'max'),
]
def parse_stat(line):
    for pat, op in PATTERNS:
        m = pat.match(line)
        if m:
            return norm_stat(m.group(2)), op, float(m.group(1))
    return None

def lines_of(sec):
    return [clean(t) for _, t in sec]

def write_csv(path, rows, cols=None):
    if not rows: return
    if cols is None:
        cols = []
        for r in rows:
            for k in r:
                if k not in cols: cols.append(k)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader(); w.writerows(rows)

def main(src, outdir):
    os.makedirs(outdir, exist_ok=True)
    d = json.load(open(src, encoding='utf-8'))
    lists = {l['id']: l['name'] for l in d['lists']}
    by_list = defaultdict(list)
    for c in d['cards']:
        if not c['closed']:
            by_list[lists[c['idList']]].append(c)
    for v in by_list.values():
        v.sort(key=lambda c: c['pos'])

    def grouped(listname):
        """Yield (group, card) — group = most recent divider card (e.g. 'Forest')."""
        group = ''
        for c in by_list[listname]:
            n = c['name']
            if n.startswith(('About -', 'Content -')): continue
            if '_Information_' not in c['desc']:
                group = n; continue
            yield group, c

    # ---------- equipment ----------
    effects = []
    for listname, fname in [('Accessories', 'accessories'), ('Weapons', 'weapons'),
                            ('Armors', 'armors'), ('Whips', 'whips')]:
        rows, statcols = [], []
        for group, c in grouped(listname):
            s = sections(c['desc'])
            desc = ' '.join(lines_of(s.get('Description', [])))
            stat_sec = s.get('Stats', []) + s.get('Passive', [])
            stats, special, notes, setb = {}, [], [], ''
            for indent, raw in stat_sec:
                t = clean(raw)
                if not t: continue
                if indent > 0 or t.lower().startswith('note'):
                    notes.append(re.sub(r'^Note\d*:\s*', '', t)); continue
                if t.startswith('Set Bonus:'):
                    setb = t; continue
                p = parse_stat(t)
                if p:
                    stat, op, val = p
                    col = f'{stat} ({op})'
                    stats[col] = val
                    if col not in statcols: statcols.append(col)
                    effects.append({'item': c['name'], 'category': fname, 'stat': stat, 'op': op, 'value': val})
                elif t != 'No stats change':
                    special.append(t)
            obtain = lines_of(s.get('How to obtain', []))
            price = ''
            for o in obtain:
                m = re.search(r'Market for ([\d,]+) (\w+)', o, re.I)
                if m: price = f"{m.group(1).replace(',', '')} {m.group(2).lower()}"
            rows.append({'name': c['name'], 'group': group, 'description': desc, **stats,
                         'special': ' | '.join(special), 'set_bonus': setb,
                         'notes': ' | '.join(notes), 'market_price': price,
                         'obtain': ' | '.join(obtain), 'trello_url': c['shortUrl']})
        statcols.sort()
        cols = ['name', 'group'] + statcols + ['special', 'set_bonus', 'description', 'notes',
                                               'market_price', 'obtain', 'trello_url']
        write_csv(f'{outdir}/{fname}.csv', rows, cols)
        print(f'{fname}: {len(rows)}')
    write_csv(f'{outdir}/item_effects.csv', effects, ['item', 'category', 'stat', 'op', 'value'])

    # ---------- units ----------
    units, ups = [], []
    num = re.compile(r'^([\d.,]+)(%?)\s+(.+?)(?:\s*\(([+-][\d.]+)%?\)?)?$')
    UALIAS = {'Perserve': 'Preserve', 'Percentage': 'Percent', 'Max Chain': 'MaxChain'}
    def ukv(m):
        k = m.group(3).strip(); k = UALIAS.get(k, k)
        v = float(m.group(1).replace(',', ''))
        if m.group(2) == '%' and k == 'Preserve': v /= 100   # store preserve as a fraction
        return k, v
    for group, c in grouped('Units'):
        s = sections(c['desc'])
        base = {}  # note: some cards say 'Mana Cost' instead of 'Mana Placement'
        for _, t in s.get('Stats', []):
            m = num.match(clean(t))
            if m:
                k, v = ukv(m); base[k] = v
        if 'Mana Placement' not in base and 'Mana Cost' in base:
            base['Mana Placement'] = base.pop('Mana Cost')
        row = {'name': c['name'], 'group': group,
               'DMG': base.get('DMG'), 'SPA': base.get('SPA'), 'RNG': base.get('RNG'),
               'Splash': base.get('Splash', ''), 'Penetration': base.get('Penetration', ''),
               'placement_cost': base.get('Mana Placement'), 'max_placements': base.get('Placements'),
               'accessory_slots': base.get('Accessories')}
        extra = {k: v for k, v in base.items() if k not in
                 ('DMG', 'SPA', 'RNG', 'Splash', 'Penetration', 'Mana Placement', 'Placements', 'Accessories')}
        row['other_stats'] = '; '.join(f'{k}={v:g}' for k, v in extra.items())
        tier, cum = 0, base.get('Mana Placement') or 0
        t0 = {'unit': c['name'], 'tier': 0}
        t0.update({k: v for k, v in base.items() if k not in ('Mana Placement', 'Placements', 'Accessories')})
        t0.update({'tier_cost': cum, 'cumulative_cost': cum})
        ups.append(t0)
        cur = None
        for indent, t in s.get('Upgrades', []):
            t = clean(t)
            if indent == 0 and t.startswith('Upgrade'):
                if cur: ups.append(cur)
                tier += 1
                cur = {'unit': c['name'], 'tier': tier}
                continue
            m = num.match(t)
            if cur is not None and m:
                k, v = ukv(m)
                if k in ('Mana Cost', 'Mana Placement', 'Mana'):  # board uses all three for upgrade cost
                    cum += v; cur['tier_cost'] = v; cur['cumulative_cost'] = cum
                else:
                    cur[k] = v
        if cur: ups.append(cur)
        row['max_tier'] = tier
        row['description'] = ' '.join(lines_of(s.get('Description', [])))
        row['trello_url'] = c['shortUrl']
        units.append(row)
    write_csv(f'{outdir}/units.csv', units)
    pref = ['unit', 'tier', 'DMG', 'SPA', 'RNG', 'Splash', 'Penetration']
    extra = sorted({k for r in ups for k in r} - set(pref) - {'tier_cost', 'cumulative_cost'})
    write_csv(f'{outdir}/unit_upgrades.csv', ups, pref + extra + ['tier_cost', 'cumulative_cost'])
    print(f'units: {len(units)}, upgrade rows: {len(ups)}')

    # ---------- enemies + banners ----------
    enemies, banners = [], {}
    for group, c in grouped('Enemies'):
        s = sections(c['desc'])
        st = {}
        for _, t in s.get('Bestiary Stats', []):
            m = re.match(r'([\d.,]+)\s+(\w+)', clean(t))
            if m: st[m.group(2)] = float(m.group(1).replace(',', ''))
        speed_note = next((clean(t) for _, t in s.get('Bestiary Stats', []) if 'Speed' in t and '→' in t), '')
        enemies.append({'name': c['name'], 'group': group, 'Health': st.get('Health', ''),
                        'Defense': st.get('Defense', ''), 'Speed': st.get('Speed', ''),
                        'mana_reward': st.get('Mana', ''), 'XP': st.get('XP', ''),
                        'speed_note': speed_note,
                        'description': ' '.join(lines_of(s.get('Description', []))),
                        'trello_url': c['shortUrl']})
        for _, t in s.get('Milestones', []):
            m = re.match(r'([\d,]+) kills - (.+? Banner) \((.+)\)$', clean(t))
            if m:
                b = banners.setdefault(m.group(2), {'banner': m.group(2), 'effect': m.group(3),
                                                    'kills_required': int(m.group(1).replace(',', '')),
                                                    'enemies': []})
                b['enemies'].append(c['name'])
    write_csv(f'{outdir}/enemies.csv', enemies)
    brows = []
    for b in banners.values():
        b['enemies'] = ' | '.join(b['enemies'])
        b['owned'] = ''
        b['verified_effect'] = ''
        brows.append(b)
    write_csv(f'{outdir}/banners.csv', brows,
              ['banner', 'effect', 'verified_effect', 'kills_required', 'enemies', 'owned'])
    print(f'enemies: {len(enemies)}, banners: {len(brows)}')

    # ---------- permanent buffs ----------
    pb_card = next((c for c in by_list['Consumables'] if c['name'] == 'Permanent Buffs'), None)
    pbs = []
    if pb_card:
        names = re.findall(r'\[([^\]]+)\]', pb_card['desc'])
        cards = {c['name']: c for c in by_list['Consumables']}
        for n in names:
            c = cards.get(n)
            if not c: continue
            s = sections(c['desc'])
            effect = ' '.join(lines_of(s.get('Stats', [])))
            lim = re.search(r'\((?:up to )?(\d+) limit\)', effect)
            pbs.append({'name': n, 'effect': effect, 'limit': lim.group(1) if lim else '',
                        'consumed': '', 'obtain': ' | '.join(lines_of(s.get('How to obtain', []))),
                        'trello_url': c['shortUrl']})
    write_csv(f'{outdir}/permanent_buffs.csv', pbs)
    print(f'permanent buffs: {len(pbs)}')

def apply_overrides(outdir, path):
    """Apply in-game corrections from overrides.csv, then rebuild item_effects.csv.
    Columns: file,name,column,value,note. A name not found in the file adds a new row."""
    if os.path.exists(path):
        ovs = list(csv.DictReader(open(path, encoding='utf-8')))
        for fname in sorted({o['file'] for o in ovs}):
            fp = f'{outdir}/{fname}.csv'
            rows = list(csv.DictReader(open(fp, encoding='utf-8')))
            cols = list(rows[0].keys()) if rows else ['name']
            for o in (o for o in ovs if o['file'] == fname):
                if fname == 'unit_upgrades':  # name written as 'Unit#tier'
                    u, t = o['name'].split('#')
                    row = next((r for r in rows if r['unit'] == u and r['tier'] == t), None)
                elif fname == 'achievements':  # name written as 'Achievement#tier'
                    a, t = o['name'].split('#')
                    row = next((r for r in rows if r['achievement'] == a and str(r['tier']) == t), None)
                    if row is None:  # a tier the board is missing: inherit category + buff from tier 1
                        base = next(r for r in rows if r['achievement'] == a)
                        row = {**base, 'tier': t, 'task': '', 'platinum': '', 'override_notes': ''}; rows.append(row)
                else:
                    row = next((r for r in rows if r['name'] == o['name']), None)
                if row is None:
                    row = {c: '' for c in cols}; row['name'] = o['name']; rows.append(row)
                if o['column'] not in cols:
                    cols.insert(cols.index('special') if 'special' in cols else len(cols), o['column'])
                    for r in rows: r.setdefault(o['column'], '')
                row[o['column']] = o['value']
                if 'verified' in cols or True:
                    row.setdefault('override_notes', '')
                    row['override_notes'] = (row['override_notes'] + ' | ' if row['override_notes'] else '') + o['note']
            if fname == 'unit_upgrades':
                cum = {}
                for r in rows:
                    if r['tier_cost'] in ('', None): continue
                    cum[r['unit']] = (0 if r['tier'] == '0' else cum.get(r['unit'], 0)) + float(r['tier_cost'])
                    r['cumulative_cost'] = cum[r['unit']]
            if fname == 'achievements':  # keep tiers in order after added rows
                order = list(dict.fromkeys(r['achievement'] for r in rows))
                rows.sort(key=lambda r: (order.index(r['achievement']), int(r['tier'])))
            if 'override_notes' not in cols: cols.append('override_notes')
            for r in rows: r.setdefault('override_notes', '')
            write_csv(fp, rows, cols)
        print(f'overrides applied: {len(ovs)}')
    # rebuild long-format effects from the (possibly corrected) wide tables
    effects = []
    for fname in ('accessories', 'weapons', 'armors', 'whips'):
        fp = f'{outdir}/{fname}.csv'
        if not os.path.exists(fp): continue
        for r in csv.DictReader(open(fp, encoding='utf-8')):
            for col, val in r.items():
                m = re.match(r'^(.+) \((mult|add|pct|max)\)$', col)
                if m and val not in ('', None):
                    effects.append({'item': r['name'], 'category': fname, 'stat': m.group(1),
                                    'op': m.group(2), 'value': float(val)})
    write_csv(f'{outdir}/item_effects.csv', effects, ['item', 'category', 'stat', 'op', 'value'])

def parse_reforges(src, outdir):
    d = json.load(open(src, encoding='utf-8'))
    c = next((c for c in d['cards'] if c['name'] == 'Reforges' and not c['closed']), None)
    if not c: return
    rows = []
    for m in re.finditer(r'^- (\w+) - (.+?) \(([\d.]+)%\)', c['desc'], re.M):
        r = {'name': m.group(1), 'DMG': 1.0, 'SPA': 1.0, 'RNG': 1.0, 'chance_pct': float(m.group(3))}
        for v, st in re.findall(r'([\d.]+)x (DMG|SPA|RNG)', m.group(2)):
            r[st] = float(v)
        rows.append(r)
    write_csv(f'{outdir}/reforges.csv', rows, ['name', 'DMG', 'SPA', 'RNG', 'chance_pct'])
    print(f'reforges: {len(rows)}')

ENEMY_ALIASES = {'Pink': 'Pinky', 'Demon': 'Demon Eye', 'Servent of Cthulhu': 'Servant of Cthulhu'}

def parse_act_spawns(src, outdir):
    """Enemy counts per biome / act / difficulty from the Matches list -> act_spawns.csv.
    Counts on the board look like one recorded run each (spawns may be random).
    Boss lines have no count (count=1, is_boss_entry=1); '+' totals = boss minions not counted."""
    d = json.load(open(src, encoding='utf-8'))
    lists = {l['id']: l['name'] for l in d['lists']}
    rows = []
    for c in d['cards']:
        m = re.match(r'(Forest|Desert|Snow) Act (\d)', c['name'])
        if c['closed'] or lists[c['idList']] != 'Matches' or not m: continue
        t = LINK.sub(r'\1', c['desc']); t = t[t.find('Number of enemies'):]
        act = diff = waves = None
        for line in t.split('\n'):
            st = line.strip()
            a = re.match(r'- Act (\d+) \((\d+) Waves?\)', st)
            if a: act, waves = a.groups(); continue
            b = re.match(r'- \*\*(\w+)\*\* \(([\d+]+) enem', st)
            if b: diff = b.group(1); continue
            e = re.match(r'- (?:(\d+) )?(.+?)(?:\(s\))?$', st)
            if e and act and diff and line.startswith('    '):
                name = ENEMY_ALIASES.get(e.group(2).strip(), e.group(2).strip())
                rows.append({'biome': m.group(1), 'act': int(act), 'waves': int(waves), 'difficulty': diff,
                             'enemy': name, 'count': int(e.group(1) or 1), 'is_boss_entry': 0 if e.group(1) else 1})
    write_csv(f'{outdir}/act_spawns.csv', rows)
    print(f'act spawn rows: {len(rows)}')

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10}

def parse_achievements(src, outdir):
    """Achievements list -> achievements.csv (one row per tier).
    Buff line: 'Each completed tier gives a global +1% DMG to your units.' -> buff_value=1, buff_op=pct, buff_stat=DMG.
    'x' buffs ('+1.02x Drop Luck') are op=mult; the board doesn't say whether tiers add or compound."""
    d = json.load(open(src, encoding='utf-8'))
    lists = {l['id']: l['name'] for l in d['lists']}
    # category comes from the index cards (Slayer / Collector / ...): some achievement cards name the wrong one
    cat_of = {}
    for c in d['cards']:
        if not c['closed'] and lists[c['idList']] == 'Achievements' and c['name'] in ('Slayer', 'Collector', 'Explorer', 'Challenger'):
            for n in re.findall(r'- \[([^\]]+)\]', c['desc']): cat_of[n] = c['name']
    rows = []
    for c in d['cards']:
        if c['closed'] or lists[c['idList']] != 'Achievements' or '**The Task:**' not in c['desc']: continue
        cat = re.search(r'achievement in (\w+) category', c['desc'])
        buff = re.search(r'Each completed tier gives a global ([^\n]+?)\.?\s*$', c['desc'], re.M)
        btxt = clean(buff.group(1)) if buff else ''
        bm = re.match(r'\+?([\d.]+)(x|%)?%?\s*(.+?)(?: to (?:your units|the player))?$', btxt)   # '+1.02x%' typo
        val, op, stat = (float(bm.group(1)), 'mult' if bm.group(2) == 'x' else 'pct' if bm.group(2) == '%' else 'add',
                         bm.group(3).strip()) if bm else ('', '', '')
        tier = None
        for line in c['desc'].split('\n'):
            h = re.match(r'- ' + re.escape(c['name']) + r' ([IVX]+)\s*$', line.strip())
            if h: tier = ROMAN.get(h.group(1)); continue
            task = re.match(r'-+\s*(.+?)\s*- (\d+) Platinum', line.strip())   # board sometimes drops the space before '-'
            if tier and task:
                rows.append({'achievement': c['name'], 'category': cat_of.get(c['name']) or (cat.group(1) if cat else ''), 'tier': tier,
                             'task': clean(task.group(1)), 'platinum': int(task.group(2)),
                             'buff_text': btxt, 'buff_stat': stat, 'buff_op': op, 'buff_value': val,
                             'trello_url': c.get('shortUrl', '')})
                tier = None
    write_csv(f'{outdir}/achievements.csv', rows)
    print(f'achievement tier rows: {len(rows)}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
    parse_reforges(sys.argv[1], sys.argv[2])
    parse_act_spawns(sys.argv[1], sys.argv[2])
    parse_achievements(sys.argv[1], sys.argv[2])
    here = os.path.dirname(os.path.abspath(__file__))
    apply_overrides(sys.argv[2], os.path.join(here, 'overrides.csv'))
