# Terraria TD Calculator

🌐 **Live site: [terrariatd.wiki](https://terrariatd.wiki)** · 🚧 *Work in progress — actively being updated.*

> Unofficial fan project by **JoltSun**. Not affiliated with Re-Logic or the Terraria Tower Defense developers.
> Base game data comes from the community [Terraria TD Remastered Trello board](https://trello.com/b/p9kIzWV6/terraria-td-remastered);
> corrections from in-game testing live in `tools/overrides.csv`.

Local calculator for Terraria Tower Defense Remastered: build a unit, pick an enemy, see real DPS.
The damage model in `calc.js` is checked against real in-game stat screens (`node tests/verify.mjs`).

## Run it
Browsers won't load CSVs from a file opened straight off disk, so serve the folder:
- **VS Code:** install *Live Server* (Ritwick Dey) → right-click `index.html` → **Open with Live Server**
- **or terminal:** `python -m http.server` in this folder → open http://localhost:8000

## Layout
| Path | What |
|---|---|
| `index.html`, `app.js`, `style.css` | the page |
| `calc.js` | the damage model (pure functions, no DOM) |
| `data.js` | CSV loading |
| `data/` | game data CSVs + `game_constants.csv` (every verified rule) |
| `tools/parse_trello.py` | rebuilds `data/` from a Trello JSON export |
| `tools/overrides.csv` | in-game corrections to the Trello data; re-applied on every rebuild |
| `tests/verify.mjs` | model vs real screenshots (needs Node) |

## Update the data when the Trello changes
1. Export the board JSON → save over `tools/board.json`
2. `python tools/parse_trello.py tools/board.json data/`
3. `node tests/verify.mjs` to make sure the model still matches

## Model in one screen
```
DMG  = base × Level × gear × reforge × Seafood × ACT × banners × achievements  (+ flat DMG last)
SPA  = base × gear × reforge × Storm Hatchling                                  (+ flat SPA last)
RNG  = base × gear × reforge × Pack a Punch × Wandering Eye Fish                (+ flat RNG last)
hit  = max(DMG × crit(2 + bonus) + whip − max(DEF − Pen − banner ignores, 0), floor)
       chains: DMG × Preserve^(k−1) per hit · pellets: DMG ÷ pellets per pellet
       + min(% × enemy max HP, 100)  — raw, ignores defense
DPS  = per-attack damage × AoE targets × (1 + double attack) ÷ SPA
```
Not modeled yet: burn/frostburn ticks, ricochet, knockback, stun, Bone Helm distance scaling, Reaper set.

## Icons
`python tools/fetch_icons.py` downloads every sprite from the Trello board into `icons/` and writes
`icons/manifest.json`. The page shows an icon beside each picker; missing icons just stay blank.
If Trello asks for a login, the script prompts for an API key + token (instructions at the top of the script).
