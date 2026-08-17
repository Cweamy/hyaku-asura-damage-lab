// ============================================================================
// studio-export.js — turn Balance Lab edits into a Studio change request.
//
//   Balance Lab edits ──▶ this ──▶ a paste-ready brief for whoever edits Studio
//
// This is the reverse of export-data.js. That one pulls the live module INTO the
// site; this one pushes tested site edits BACK OUT, as a document that states
// exactly which Studio path to touch, what the value is now, and what it should
// become — plus the instruction prompt an agent needs to do it safely.
//
// Loaded both ways:
//   browser  window.HU.studioExport(config)      (Balance Lab button)
//   node     require("./studio-export.js")       (export-studio.js CLI)
//
// The field→path mapping is the whole point of the file. Two traps it encodes:
//   1. A skill's ENFORCED cooldown is the top-level `Skills.<X>.Cooldown`, not
//      `SkillData.Cooldown` (VarManager CalculateSkillStats → PickCD). They
//      differ on 36 of 97 skills.
//   2. Damage/cooldown/range/speed live in CombatCalcsData, but BEHAVIOUR
//      (hyperarmor, i-frames, stun, ragdoll, knockback) lives in the
//      SkillReg.<Skill> module. A request that needs behaviour work is flagged
//      rather than silently written into the data table.
// ============================================================================

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.HU = window.HU || {};
    window.HU.studioExport = api.buildDocument;
    window.HU.studioExportApi = api;
  }
})(this, function () {
  "use strict";

  var MODULE = "game.ServerScriptService.Modules.CombatCalcsData";

  // Balance Lab skill-override key -> where that value actually lives in Studio.
  var SKILL_FIELD_MAP = {
    power: { path: "Skills.%s.SkillData.Power", label: "Power" },
    range: { path: "Skills.%s.SkillData.Range", label: "Range" },
    speed: { path: "Skills.%s.SkillData.Speed", label: "Speed" },
    cooldown: {
      path: "Skills.%s.Cooldown",
      label: "Cooldown",
      note: "top-level Cooldown is the enforced one (CalculateSkillStats → PickCD); " +
        "leave SkillData.Cooldown alone unless the upgrade base is meant to move too",
    },
  };

  var SCALING_FIELDS = [
    "StrengthScaling", "UpperMuscleScaling", "LowerMuscleScaling",
    "FatScaling", "AgilityScaling", "AttackSpeedScaling",
  ];

  function fmt(n) {
    if (n === null || n === undefined || n === "") return "—";
    var num = Number(n);
    if (!isFinite(num)) return String(n);
    return String(Math.round(num * 1e6) / 1e6);
  }

  function pct(before, after) {
    var b = Number(before), a = Number(after);
    if (!isFinite(b) || !isFinite(a) || b === 0) return "—";
    var d = ((a - b) / Math.abs(b)) * 100;
    return (d >= 0 ? "+" : "") + (Math.round(d * 10) / 10) + "%";
  }

  // ---- change collection ----------------------------------------------------

  // Reads the live snapshot the site was built from, so "current" in the brief is
  // the live value, never another override.
  function collect(config, data) {
    var changes = [];
    var warnings = [];

    var sover = config.sover || {};
    Object.keys(sover).sort().forEach(function (style) {
      var live = data.styles[style];
      if (!live) {
        warnings.push("style `" + style + "` is not in the live Styles table — skipped");
        return;
      }
      Object.keys(sover[style]).sort().forEach(function (field) {
        var after = Number(sover[style][field]);
        var before = live[field];
        if (before !== undefined && Number(before) === after) return; // no-op edit
        changes.push({
          kind: "style",
          target: style,
          field: field,
          path: "Styles." + style + "." + field,
          before: before,
          after: after,
          isNew: before === undefined,
        });
      });
    });

    var over = config.over || {};
    Object.keys(over).sort().forEach(function (skill) {
      var live = data.skills[skill];
      if (!live) {
        warnings.push("skill `" + skill + "` is not in the live Skills table — skipped");
        return;
      }
      var edits = over[skill] || {};

      Object.keys(SKILL_FIELD_MAP).forEach(function (key) {
        if (edits[key] === undefined || edits[key] === "") return;
        var map = SKILL_FIELD_MAP[key];
        var after = Number(edits[key]);
        var before = key === "cooldown"
          ? live.Cooldown
          : (live.SkillData || {})[map.label];
        if (before !== undefined && Number(before) === after) return;
        changes.push({
          kind: "skill",
          target: skill,
          field: map.label,
          path: map.path.replace("%s", skill),
          before: before,
          after: after,
          note: map.note,
          isNew: before === undefined,
        });
      });

      var scaling = edits.scaling || {};
      Object.keys(scaling).sort().forEach(function (field) {
        if (SCALING_FIELDS.indexOf(field) === -1) {
          warnings.push("`" + skill + "." + field + "` is not a known scaling field — skipped");
          return;
        }
        var liveScaling = data.skillScaling[skill];
        var after = Number(scaling[field]);
        var before = liveScaling ? liveScaling[field] : undefined;
        if (before !== undefined && Number(before) === after) return;
        changes.push({
          kind: "scaling",
          target: skill,
          field: field,
          path: "SkillScaling." + skill + "." + field,
          before: before,
          after: after,
          isNew: !liveScaling || before === undefined,
          note: liveScaling ? undefined :
            "no live SkillScaling entry for this skill — it currently falls back to the 0.75 × SkillBonus multiplier; adding one changes its damage on its own",
        });
      });

      if (edits.hits !== undefined && edits.hits !== "") {
        warnings.push("`" + skill + "` has a hit-count override (" + edits.hits + "). Hit count is not data — " +
          "it comes from the DealDamage calls in SkillReg." + skill + ", so it needs a code change, not a value edit.");
      }
    });

    return { changes: changes, warnings: warnings };
  }

  // ---- impact ---------------------------------------------------------------

  // Recomputes damage before/after so the brief carries the consequence, not just
  // the coefficient. Uses the same calc.js the site displays.
  function impact(config, data, calc) {
    if (!calc) return [];
    var stats = config.stats;
    if (!stats) return [];
    var rows = [];

    var sover = config.sover || {};
    Object.keys(sover).sort().forEach(function (name) {
      var live = data.styles[name];
      if (!live) return;
      var edited = Object.assign({}, live);
      Object.keys(sover[name]).forEach(function (f) { edited[f] = Number(sover[name][f]); });
      rows.push({
        kind: "style",
        name: name,
        m1: [calc.ComputeM1Damage({ style: live, stats: stats, basicAttackDmg: 1 }),
             calc.ComputeM1Damage({ style: edited, stats: stats, basicAttackDmg: 1 })],
        m2: [calc.ComputeM2Damage({ style: live, stats: stats, criticalDmg: 1 }),
             calc.ComputeM2Damage({ style: edited, stats: stats, criticalDmg: 1 })],
        drainM1: [calc.GetStamDrain({ style: live, stats: stats, attack: "M1" }),
                  calc.GetStamDrain({ style: edited, stats: stats, attack: "M1" })],
        drainM2: [calc.GetStamDrain({ style: live, stats: stats, attack: "M2" }),
                  calc.GetStamDrain({ style: edited, stats: stats, attack: "M2" })],
      });
    });

    var over = config.over || {};
    Object.keys(over).sort().forEach(function (name) {
      var live = data.skills[name];
      if (!live) return;
      var edits = over[name] || {};
      var liveScaling = data.skillScaling[name];
      var editedScaling = Object.assign({}, liveScaling || {}, edits.scaling || {});
      Object.keys(editedScaling).forEach(function (k) { editedScaling[k] = Number(editedScaling[k]); });
      var livePower = (live.SkillData || {}).Power;
      var newPower = edits.power !== undefined && edits.power !== "" ? Number(edits.power) : livePower;
      if (typeof livePower !== "number") return;
      // Skip skills whose only "edit" changes nothing here (e.g. a hit-count
      // override, which is reported as a warning instead).
      var touchesValues = ["power", "cooldown", "range", "speed"].some(function (k) {
        return edits[k] !== undefined && edits[k] !== "";
      }) || Object.keys(edits.scaling || {}).length > 0;
      if (!touchesValues) return;
      rows.push({
        kind: "skill",
        name: name,
        dmg: [calc.ComputeSkillDamage({ skillName: name, skill: live, stats: stats }),
              calc.ComputeSkillDamage({ power: newPower, scaling: editedScaling, stats: stats })],
        cooldown: [live.Cooldown,
                   edits.cooldown !== undefined && edits.cooldown !== "" ? Number(edits.cooldown) : live.Cooldown],
      });
    });

    return rows;
  }

  // ---- document -------------------------------------------------------------

  function table(header, rows) {
    var out = ["| " + header.join(" | ") + " |", "| " + header.map(function (h, i) {
      return i === 0 ? "---" : "---:";
    }).join(" | ") + " |"];
    rows.forEach(function (r) { out.push("| " + r.join(" | ") + " |"); });
    return out.join("\n");
  }

  function buildDocument(config, opts) {
    opts = opts || {};
    var data = opts.data || (typeof window !== "undefined" ? window.HYAKU_DATA : null);
    var calc = opts.calc || (typeof window !== "undefined" ? window.HyakuCalc : null);
    if (!data) throw new Error("studio-export: no data snapshot supplied");

    var stamp = opts.date || "(undated)";
    var res = collect(config, data);
    var changes = res.changes;
    var lines = [];

    lines.push("# Studio change request — Hyaku Asura balance");
    lines.push("");
    lines.push("Generated from the Damage Lab on " + stamp + " against `DATA_VERSION " + (data.DATA_VERSION || "?") + "`.");
    lines.push("");

    // ---- the instruction prompt (the part that gets pasted to an agent) ----
    lines.push("## Instructions");
    lines.push("");
    lines.push("Apply the table below to the live Roblox Studio place. Work only through the");
    lines.push("Roblox MCP tools against the connected place — the website is a mirror, not the");
    lines.push("source of truth, and nothing here is applied until Studio is edited.");
    lines.push("");
    lines.push("1. **Target module:** `" + MODULE + "`.");
    lines.push("   Every path in the table is relative to that module's returned table.");
    lines.push("2. **Read before writing.** For each row, read the current value in Studio and");
    lines.push("   confirm it matches the \"Live now\" column. If it does not, stop and report the");
    lines.push("   mismatch — it means the place moved since this brief was generated, and the");
    lines.push("   requested value may have been computed against stale numbers.");
    lines.push("3. **Change only the listed field** on the listed entry. Keep the surrounding");
    lines.push("   formatting, key order, and comment style exactly as they are.");
    lines.push("4. **Do not touch the archived copies.** `ServerStorage.Snapshots.*`,");
    lines.push("   `ServerStorage.donottouch.*`, and `ServerStorage[\"MainScript <-- OG\"]` are");
    lines.push("   history, and the client mirrors under `StarterPlayer` are generated.");
    lines.push("5. **Re-read every edited script** after writing it, and confirm the module still");
    lines.push("   loads (`require` it, or run the narrowest available playtest validation).");
    lines.push("6. **Record before/after** for every changed value in `BALANCE_CHANGELOG.md`.");
    lines.push("7. **Sync the mirror back** once Studio is correct:");
    lines.push("   - run `website/studio-dump.luau` (MODE = `\"json\"`), save the output as");
    lines.push("     `website/combat-calcs-data.dump.json`;");
    lines.push("   - `node export-data.js combat-calcs-data.dump.json`;");
    lines.push("   - `node --check data.js && node test.js`;");
    lines.push("   - `node dump-digest.js --data --compare <live digest>` must say IN SYNC.");
    lines.push("");
    lines.push("**Field mapping traps** (already resolved in the table — do not \"fix\" them):");
    lines.push("");
    lines.push("- A skill's enforced cooldown is `Skills.<Skill>.Cooldown`. `SkillData.Cooldown`");
    lines.push("  is only the per-upgrade base and disagrees on 36 of 97 skills.");
    lines.push("- Damage numbers live in `CombatCalcsData`; behaviour (hyperarmor, i-frames,");
    lines.push("  stun, ragdoll, knockback, hit counts) lives in");
    lines.push("  `game.ServerScriptService.Modules.VarManager.SkillReg.<Skill>`. If a row seems");
    lines.push("  to need a behaviour change, stop and ask rather than inventing a data field.");
    lines.push("- `BaseDamageM2` is dead data: M2 = M1 × `M2GlobalMultiplier` (1.12). Editing it");
    lines.push("  changes the site's display and nothing in the game.");
    lines.push("");

    // ---- the changes ----
    lines.push("## Changes (" + changes.length + ")");
    lines.push("");
    if (!changes.length) {
      lines.push("_No value changes in this config — the Balance Lab had no edits, or every edit");
      lines.push("matched the live value._");
    } else {
      lines.push(table(
        ["Studio path", "Live now", "Set to", "Δ"],
        changes.map(function (c) {
          return ["`" + c.path + "`", fmt(c.before), fmt(c.after), c.isNew ? "new field" : pct(c.before, c.after)];
        })
      ));
      var noted = changes.filter(function (c) { return c.note; });
      if (noted.length) {
        lines.push("");
        lines.push("Per-row notes:");
        lines.push("");
        noted.forEach(function (c) { lines.push("- `" + c.path + "` — " + c.note); });
      }
    }
    lines.push("");

    // ---- impact ----
    var rows = impact(config, data, calc);
    if (rows.length && config.stats) {
      lines.push("## Expected impact");
      lines.push("");
      lines.push("At the test build in this config: " + Object.keys(config.stats).sort().map(function (k) {
        return k + " " + config.stats[k];
      }).join(", ") + ".");
      lines.push("");
      var styleRows = rows.filter(function (r) { return r.kind === "style"; });
      if (styleRows.length) {
        lines.push(table(["Style", "M1", "M2", "M1 drain", "M2 drain"], styleRows.map(function (r) {
          return [r.name,
            fmt(r.m1[0]) + " → " + fmt(r.m1[1]),
            fmt(r.m2[0]) + " → " + fmt(r.m2[1]),
            fmt(r.drainM1[0]) + " → " + fmt(r.drainM1[1]),
            fmt(r.drainM2[0]) + " → " + fmt(r.drainM2[1])];
        })));
        lines.push("");
      }
      var skillRows = rows.filter(function (r) { return r.kind === "skill"; });
      if (skillRows.length) {
        lines.push(table(["Skill", "Damage/hit", "Δ", "Cooldown"], skillRows.map(function (r) {
          return [r.name,
            fmt(r.dmg[0]) + " → " + fmt(r.dmg[1]),
            pct(r.dmg[0], r.dmg[1]),
            fmt(r.cooldown[0]) + " → " + fmt(r.cooldown[1])];
        })));
        lines.push("");
      }
    }

    if (res.warnings.length) {
      lines.push("## Needs a decision before applying");
      lines.push("");
      res.warnings.forEach(function (w) { lines.push("- " + w); });
      lines.push("");
    }

    // ---- machine-readable payload ----
    lines.push("## Payload");
    lines.push("");
    lines.push("Exact values, for scripted application or cross-checking the table:");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({
      module: MODULE,
      dataVersion: data.DATA_VERSION || null,
      generated: stamp,
      stats: config.stats || null,
      changes: changes.map(function (c) {
        return { path: c.path, field: c.field, before: c.before === undefined ? null : c.before, after: c.after };
      }),
    }, null, 2));
    lines.push("```");
    lines.push("");

    return lines.join("\n");
  }

  return {
    buildDocument: buildDocument,
    collect: collect,
    impact: impact,
    SKILL_FIELD_MAP: SKILL_FIELD_MAP,
    MODULE: MODULE,
  };
});
