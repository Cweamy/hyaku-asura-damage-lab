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
| `index.html` | Tool layout: player stats, all-styles damage matrix, style readouts, skills, compare list, Balance Lab, analysis, share. Sticky section nav with scroll-spy. |
| `style.css` | Dark slate-900 / emerald-400 theme, glass sticky nav, hero + feature cards, Balance Lab, back-to-top |
| `app.js` | Application glue: event wiring, share-code encode/decode, presets, nav + scroll-spy, Balance Lab actions (`window.HU.app`) |
| `render.js` | All DOM rendering: matrix, style, skills, compare, scenario, analysis tools, Balance Lab (`window.HU.render`) |
| `util.js` | Shared logic & state: `window.HU` — helpers, single mutable `state`, data verification, damage cache |
| `calc.js` | 1:1 port of `CombatCalculation` (window.HyakuCalc) |
| `data.js` | Static snapshot of `CombatCalcsData` (window.HYAKU_DATA) with a `DATA_VERSION` field |

## Architecture notes

- **State lives in one place** (`util.js → HU.state`). `render.js` only reads it and
  writes the DOM; `app.js` owns state transitions. No module touches the DOM directly
  except through `HU.render`.
- **Every value interpolated into HTML is escaped** with `HU.esc()` — share links are
  user-crafted, so nothing from data or config is trusted as HTML.
- **Damage is cached.** Results are keyed by a stats/overrides signature, so typing in a
  stat field doesn't recompute ~90 skills from scratch on every keystroke.
- **Total skill damage = Dmg/hit × live hit-ratio sum** (`stageData.sum`). The "Hits"
  edit only changes how many hits feed the hit-count-decay simulation — it never silently
  changes the authoritative total (previously the two were conflated).
- **Data health check.** On load the page verifies that every style/skill/scaling
  reference resolves and shows the `DATA_VERSION` in the health bar, so stale or drifted
  exports are obvious instead of failing silently.

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

1. In Studio, require the module and serialize `{ Styles, SkillScaling, Skills, stageData }` to JSON
   (see the Luau serializer snippet in `export-data.js` header; `stageData` is optional — it maps
   each skill to `{ hits, sum }` read from the live `SkillReg.<Skill>` modules, where `hits` is the
   number of `DealDamage` applications per Activate and `sum` is the total damage-ratio multiplier
   dealt), save it as `combat-calcs-data.dump.json`.
2. `node export-data.js combat-calcs-data.dump.json` — replaces the styles / skillScaling /
   skills / stageData blocks, preserves site-only entries (Jujutsu, Rushing_Kick, ...), keeps the
   skill annotations the module doesn't carry (StaminaCost, GrabSkill, IFrame, ...), bumps
   `DATA_VERSION`, and cross-verifies every dump value.
3. `node --check data.js` and `node test.js`.
4. Open the page and spot-check: default stats, The_Middle M1/M2 damage, one skill's damage.
5. Update the "as of" date in `index.html` and the footer.

## Verifying calc parity

`calc.js` formulas were smoke-tested in Node against the Lua sources
(e.g. `EffectiveStat(2000 Strength) = 1725`, The_Middle M1 = 277.40, M2 = 310.68,
hit-count decay, stamina drains).

There is an automated suite that locks this down and checks data integrity:

```powershell
cd website
node test.js        # or: npm test
```

It asserts calc parity, catches orphan `skillScaling` / broken `styleOrder` references
(hard failures), and prints the same data-health warnings the on-page health bar shows
(missing styles, missing `stageData`). Run it after touching `calc.js`, `util.js`, or
re-exporting `data.js`.

## Balance-pass workflow

- Tester requests go into the balance pass (see `BALANCE_CHANGELOG.md` / `PROJECT_STATE.md`).
- Use the app: copy the config → edit balance cells → paste the new config into the changelog.
- Apply percentage changes multiplicatively to the current live value; record before/after for
  every changed value; keep edits scoped to one style/move; re-export `data.js` after Studio edits.
