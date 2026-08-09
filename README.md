# Hyaku Asura — Damage Lab

Static, client-side damage / balance testing tool for the Roblox game **Hyaku Asura**.

It mirrors the live game logic:
- `game.ServerScriptService.Modules.CombatCalculation` → `calc.js`
- `game.ServerScriptService.Modules.CombatCalcsData` → `data.js`

Nothing is sent to a server. Everything (stats, style, balance edits, compare list,
analysis target) is encoded into a shareable config in the URL hash (`#cfg=...`).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tool layout: player stats, all-styles damage matrix, balance edit, skills, compare list, analysis, share |
| `style.css` | Dark slate-900 / emerald-400 theme, glass sticky nav, hero + feature cards |
| `app.js` | App logic, analysis tools, share-code encode/decode, presets |
| `calc.js` | 1:1 port of `CombatCalculation` (window.HyakuCalc) |
| `data.js` | Static snapshot of `CombatCalcsData` (window.HYAKU_DATA) |

## Use locally

Open `website/index.html` in a browser (any static server works):

```powershell
cd website
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

1. Create a repo and push the `website/` folder contents to a `gh-pages` branch (or the default branch and enable Pages).
2. Share links are self-contained (`https://<user>.github.io/<repo>/#cfg=...`) — no backend needed.

## Re-exporting live data (IMPORTANT)

`data.js` is a snapshot of the live `CombatCalcsData`. Whenever combat data changes in Studio,
**re-export it** — do not hand-edit `data.js` as a second source of truth.

Export the styles/skills block as a JS object and write it into `window.HYAKU_DATA` with the
same structure `data.js` already uses. After exporting:

1. `node --check data.js`
2. Open the page and spot-check: default stats, The_Middle M1/M2 damage, one skill's damage.
3. Update the "as of" date in `index.html` and the footer.

## Verifying calc parity

`calc.js` formulas were smoke-tested in Node against the Lua sources
(e.g. `EffectiveStat(2000 Strength) = 1725`, The_Middle M1 = 248.88, M2 = 278.74,
hit-count decay, stamina drains). Re-run a smoke test after touching either side.

## Balance-pass workflow

- Tester requests go into the balance pass (see `BALANCE_CHANGELOG.md` / `PROJECT_STATE.md`).
- Use the app: copy the config → edit balance cells → paste the new config into the changelog.
- Apply percentage changes multiplicatively to the current live value; record before/after for
  every changed value; keep edits scoped to one style/move; re-export `data.js` after Studio edits.
