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
| `studio-export.js` | Balance edits → Studio change request; loaded by the page and by the CLI |

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

## The two directions

The site mirrors Studio; Studio is the source of truth. Data moves both ways, and each
direction has its own tool.

```
Studio ──studio-dump.luau──▶ combat-calcs-data.dump.json ──export-data.js──▶ data.js
Studio ◀── (a human/agent applies it) ◀── studio change request ◀──studio-export.js── Balance Lab
```

| Tool | Runs in | Does |
| --- | --- | --- |
| `studio-dump.luau` | Studio | Serializes the live `CombatCalcsData` (+ resolved `EffectiveFlags`) to JSON |
| `export-data.js` | node | Writes that dump into `data.js` and cross-verifies every value |
| `dump-digest.js` | node | Cheap drift check: is the site still identical to live? |
| `parity-sweep.luau` | Studio | Runs 552 formula rows through the live `CombatCalculation` |
| `parity-check.js` | node | Runs the same rows through `calc.js` and diffs them |
| `studio-export.js` | both | Turns Balance Lab edits into a Studio change request |
| `export-studio.js` | node | CLI wrapper for the above (takes a share code) |
| `apply-balance.js` | node | Writes a tested share config into `data.js` directly |

## Checking for drift (do this first)

Before trusting the site, confirm it still matches the game:

1. Run `studio-dump.luau` with `MODE = "digest"` in Studio, save the output to a file.
2. `node dump-digest.js --data --compare <that file>` — prints `IN SYNC`, or names every
   entry that drifted.
3. Run `parity-sweep.luau` in Studio (default `MODE = "hash"`) and compare with
   `node parity-check.js`. Equal hashes mean all 552 formula rows match. If not, rerun the
   sweep with `MODE = "rows"`, save it, and `node parity-check.js --live <file>` to see
   exactly which formula moved.

## Re-exporting live data (IMPORTANT)

`data.js` is a snapshot of the live `CombatCalcsData`. Whenever combat data changes in Studio,
**re-export it** — do not hand-edit `data.js` as a second source of truth.

1. Run `studio-dump.luau` in Studio with `MODE = "json"` (Command Bar or the Roblox MCP's
   `execute_luau`) and save the output as `combat-calcs-data.dump.json`. It emits
   `{ Styles, SkillScaling, Skills, EffectiveFlags }`. `stageData` is deliberately not dumped —
   it is hand-derived from the `SkillReg.<Skill>` modules (`hits` = `DealDamage` applications per
   Activate, `sum` = total damage-ratio multiplier) and the existing block is kept.
2. `node export-data.js combat-calcs-data.dump.json` — replaces the styles / skillScaling /
   skills / stageData blocks, preserves site-only entries, applies `EffectiveFlags`
   authoritatively (so a flag removed in a balance pass is cleared, not preserved), bumps
   `DATA_VERSION`, and cross-verifies every dump value.
3. `node --check data.js` and `node test.js`.
4. Open the page and spot-check: default stats, The_Middle M1/M2 damage, one skill's damage.
5. Update the "as of" date in `index.html` and the footer.

## Sending balance changes back to Studio

Tune values in the Balance Lab, then press **Copy Studio change request**. You get a
paste-ready brief containing:

- the instruction prompt (target module, read-before-write, what not to touch, how to verify,
  and how to re-sync the mirror afterwards);
- every edit as a real Studio path with its live value, the requested value, and the delta;
- the expected damage/drain impact at your test build;
- anything that needs a decision instead of an edit (e.g. a hit-count change, which lives in a
  `SkillReg` module rather than in data);
- a JSON payload of the same changes.

From a share link instead: `node export-studio.js "<share code>" -o studio-change-request.md`.

**Two mapping traps the export already handles** — worth knowing when reading the game code:

- A skill's *enforced* cooldown is `Skills.<Skill>.Cooldown`, not `SkillData.Cooldown`
  (`VarManager.CalculateSkillStats` → `PickCD`). They disagree on 36 of 97 skills.
- Damage numbers live in `CombatCalcsData`; behaviour (hyperarmor, i-frames, stun, ragdoll,
  knockback, hit counts) lives in `VarManager.SkillReg.<Skill>`.

## Verifying calc parity

`calc.js` formulas were smoke-tested in Node against the Lua sources
(e.g. `EffectiveStat(2000 Strength) = 1150`, The_Middle M1 = 216.7264, M2 = 242.733568,
hit-count decay, stamina drains). Anchors were re-verified against the live
`CombatCalculation` module on 2026-08-11 (post statLimits re-sync); see
`../BALANCE_CHANGELOG.md`. A full-matrix parity sweep (527 rows: 80 skills x 3 stat
profiles, 25 styles' M1/M2 x 2 profiles, drains, defenses, attack-speed multipliers,
decay/rhythm/landed) matches the live module exactly.

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
