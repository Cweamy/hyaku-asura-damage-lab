#!/usr/bin/env node
// ============================================================================
// export-data.js — regenerate data.js combat blocks from the live module.
//
// The source of truth is `game.ServerScriptService.Modules.CombatCalcsData`.
// To re-export:
//   1. In Studio, require the module and serialize { Styles, SkillScaling,
//      Skills, stageData } to JSON. stageData is optional: when omitted the
//      existing block is kept. It maps skill name -> { hits, sum } where hits
//      is the number of DealDamage applications per Activate and sum is the
//      total damage-ratio multiplier dealt (Σ ratio per application), read
//      from the live SkillReg.<Skill> modules (Stages + FinalDamage/DealDamage
//      usage). See the serializer snippet in README.md.
//   2. Save that JSON to a file, e.g. combat-calcs-data.dump.json
//   3. Run:  node export-data.js combat-calcs-data.dump.json
//
// What it does:
//   - Replaces the `styles`, `skillScaling`, `skills`, and (when present in
//     the dump) `stageData` blocks of data.js with the dump contents,
//     formatted to match the file's existing style.
//   - Preserves site-only data the dump does not carry: `skillStatsForBots`,
//     `constants`, `statLimits`, `styleOrder`, skills that only exist in the
//     site (e.g. Rushing_Kick), the Jujutsu style fallback block, and
//     stageData entries for skills without a SkillReg module.
//   - Bumps DATA_VERSION (default: today, UTC; pass --version to pin it).
//   - Cross-verifies: re-loads data.js and asserts every dump value matches.
//
// Usage:
//   node export-data.js <dump.json> [--version YYYY-MM-DD] [--dry-run]
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DATA_FILE = path.join(__dirname, "data.js");

function fail(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---- value formatting --------------------------------------------------------

function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function valJS(v) {
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(valJS).join(", ") + "]";
  if (v && typeof v === "object") {
    const parts = Object.keys(v).map((k) => k + ": " + valJS(v[k]));
    return "{ " + parts.join(", ") + " }";
  }
  return "null";
}

// Keys like "Grand-WarAxe" or "Yuzuki-no-Mai" are not valid JS identifiers and
// must be quoted in the generated object.
function keyJS(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// ---- field ordering (match the existing data.js formatting) ------------------

const STYLE_ORDER = [
  "M1RangeMul", "BaseStun", "BaseDamageM1", "BaseDamageM2",
  "M1Range", "M2Range", "MaxCombo", "ComboLife",
  "M1ComboCooldowns", "M1ComboLifes",
  "M1Speed", "M2Speed", "M1StaminaCost", "M2StaminaCost",
  "M2Cooldown", "M1Endlag", "M2Endlag", "Endlag",
  "StrengthScaling", "UpperMuscleScaling", "LowerMuscleScaling", "FatScaling",
  "AgilityScaling", "AttackSpeedScaling", "MaxAttackSpeedScale", "M2MaxAttackSpeedScale",
  "TMThreshold", "StaminaScaling", "StaminaScalingCap",
];

const SCALING_ORDER = [
  "StrengthScaling", "UpperMuscleScaling", "LowerMuscleScaling",
  "FatScaling", "AgilityScaling", "AttackSpeedScaling",
];

const SKILL_ORDER = [
  "DisplayName", "Style", "Cooldown", "StaminaCost",
  "HyperArmour", "GrabSkill", "CounterSkill", "IFrame",
  "ClashPriority", "IsExtender", "IsPure", "MissEndlag",
  "IgnoreOffensiveCheck", "Silenceable", "Clashable", "IsSkill",
  "SkillData", "Stages",
];

// Per-skill badge flags render.js shows. The dump resolves these to their live
// runtime value in `EffectiveFlags`, and they are applied authoritatively.
const DISPLAY_FLAGS = ["HyperArmour", "GrabSkill", "CounterSkill", "IFrame"];

const SKILLDATA_ORDER = ["Cooldown", "Power", "Range", "Speed"];
const AFFECT_ORDER = ["Power", "Speed", "Cooldown", "PerUpgrade", "ScaleBy"];
const STAGE_ORDER = ["DamageRatio", "Stun", "Ragdoll", "Blockbreak", "IFrame"];

function orderKeys(obj, order) {
  const known = order.filter((k) => obj[k] !== undefined);
  const unknown = Object.keys(obj).filter((k) => order.indexOf(k) === -1).sort();
  return known.concat(unknown);
}

// ---- block generators ---------------------------------------------------------

function styleBlock(name, obj) {
  const keys = orderKeys(obj, STYLE_ORDER);
  const lines = [];
  let cur = [];
  const push = () => {
    if (cur.length) {
      lines.push("      " + cur.join(", ") + ",");
      cur = [];
    }
  };
  for (const k of keys) {
    if (k === "StaminaScaling" || k === "StaminaScalingCap") {
      push();
      lines.push("      " + k + ": " + valJS(obj[k]) + ",");
      continue;
    }
    cur.push(k + ": " + valJS(obj[k]));
    if (cur.length === 4) push();
  }
  push();
  return "    " + keyJS(name) + ": {\n" + lines.join("\n") + "\n    },";
}

function scalingLine(name, obj) {
  const keys = orderKeys(obj, SCALING_ORDER);
  return "    " + keyJS(name) + ": { " + keys.map((k) => k + ": " + valJS(obj[k])).join(", ") + " },";
}

function skillLine(name, obj) {
  const parts = [];
  for (const k of orderKeys(obj, SKILL_ORDER)) {
    if (k === "SkillData") {
      parts.push("SkillData: { " + skillDataInner(obj[k]) + " }");
    } else if (k === "Stages") {
      parts.push("Stages: { " + stagesInner(obj[k]) + " }");
    } else {
      parts.push(k + ": " + valJS(obj[k]));
    }
  }
  return "    " + keyJS(name) + ": { " + parts.join(", ") + " },";
}

function skillDataInner(sd) {
  const parts = [];
  for (const k of orderKeys(sd || {}, SKILLDATA_ORDER)) {
    const v = sd[k];
    if (v && typeof v === "object" && !Array.isArray(v) && v.Base !== undefined) {
      const affects = orderKeys(v.Affect || {}, AFFECT_ORDER);
      parts.push(k + ": { Base: " + fmtNum(v.Base) + ", Affect: { " +
        affects.map((a) => a + ": " + fmtNum(v.Affect[a])).join(", ") + " } }");
    } else {
      parts.push(k + ": " + valJS(v));
    }
  }
  return parts.join(", ");
}

function stagesInner(stages) {
  const parts = [];
  for (const name of Object.keys(stages || {})) {
    const s = stages[name];
    const keys = orderKeys(s, STAGE_ORDER);
    parts.push(name + ": { " + keys.map((k) => k + ": " + valJS(s[k])).join(", ") + " }");
  }
  return parts.join(", ");
}

// ---- splice helpers -----------------------------------------------------------

function spliceBetween(text, startAnchor, endAnchor, replacement, label) {
  const s = text.indexOf(startAnchor);
  if (s === -1) fail("anchor not found: " + label + " start (" + startAnchor + ")");
  const start = s + startAnchor.length;
  const e = text.indexOf(endAnchor);
  if (e === -1 || e < start) fail("anchor not found: " + label + " end (" + endAnchor + ")");
  return text.slice(0, start) + "\n" + replacement + "\n" + text.slice(e);
}

// ---- main ---------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.log("Usage: node export-data.js <dump.json> [--version YYYY-MM-DD] [--dry-run]");
    process.exit(0);
  }
  const dry = argv.includes("--dry-run");
  const verIdx = argv.indexOf("--version");
  const version = verIdx >= 0 ? argv[verIdx + 1] : today();

  const dump = JSON.parse(fs.readFileSync(argv[0], "utf8"));
  if (!dump.Styles || !dump.SkillScaling || !dump.Skills) {
    fail("dump must contain Styles, SkillScaling and Skills");
  }

  let text = fs.readFileSync(DATA_FILE, "utf8");
  const old = text;

  // Load old data for site-only merges.
  global.window = {};
  vm.runInThisContext(old, { filename: DATA_FILE });
  const OLD = global.window.HYAKU_DATA;

  const dumpStyles = Object.keys(dump.Styles);
  const oldStyles = Object.keys(OLD.styles);
  const siteOnlyStyles = oldStyles.filter((s) => !dumpStyles.includes(s)); // e.g. Jujutsu

  const dumpSkills = Object.keys(dump.Skills);
  const oldSkills = Object.keys(OLD.skills);
  const siteOnlySkills = oldSkills.filter((s) => !dumpSkills.includes(s));

  const dumpScaling = Object.keys(dump.SkillScaling);
  const oldScaling = Object.keys(OLD.skillScaling);
  const siteOnlyScaling = oldScaling.filter((s) => !dumpScaling.includes(s));

  // Merge policy: the dump is the source of truth for keys it carries. The site
  // keeps extra annotations the module's tables don't carry (site-only skills,
  // Jujutsu style fallback, bot stats, etc.). The live Skills table now carries
  // damage stats inside SkillData, so any stale top-level Power/Range/Speed left
  // over from older site data is removed for skills that have live SkillData.
  const mergedStyles = {};
  for (const s of dumpStyles) mergedStyles[s] = Object.assign({}, OLD.styles[s] || {}, dump.Styles[s]);
  const mergedScaling = {};
  for (const s of dumpScaling) mergedScaling[s] = Object.assign({}, OLD.skillScaling[s] || {}, dump.SkillScaling[s]);
  const mergedSkills = {};
  for (const s of dumpSkills) {
    mergedSkills[s] = Object.assign({}, OLD.skills[s] || {}, dump.Skills[s]);
    if (mergedSkills[s].SkillData) {
      delete mergedSkills[s].Power;
      delete mergedSkills[s].Range;
      delete mergedSkills[s].Speed;
    }
  }

  // Badge flags are authoritative, not merge-preserved. A skill's runtime value
  // is its SkillReg module field overridden by CombatCalcsData, which the dump
  // resolves into EffectiveFlags — so absent means "off live", and preserving an
  // old `true` would keep showing a flag that was removed in a balance pass
  // (Whirl Slam / Write 'em All Down still advertised hyperarmor this way).
  if (dump.EffectiveFlags) {
    const cleared = [];
    for (const s of dumpSkills) {
      const live = dump.EffectiveFlags[s] || {};
      for (const flag of DISPLAY_FLAGS) {
        if (live[flag] === true) {
          mergedSkills[s][flag] = true;
        } else if (dump.Skills[s][flag] !== undefined) {
          // CombatCalcsData states it explicitly (e.g. HyperArmour = false) — keep
          // the dumped value so the dump/data.js invariant still holds.
          mergedSkills[s][flag] = dump.Skills[s][flag];
        } else if (mergedSkills[s][flag] !== undefined) {
          if (mergedSkills[s][flag] === true) cleared.push(s + "." + flag);
          delete mergedSkills[s][flag];
        }
      }
    }
    if (cleared.length) console.log("Cleared stale flags: " + cleared.join(", "));
  }

  // stageData: dump values win; site-only entries (skills with no SkillReg
  // module) are kept from the old block. Order: old order first, then any new
  // keys alphabetically, so re-exports produce a stable, minimal diff.
  const dumpStage = dump.stageData || {};
  const oldStage = OLD.stageData || {};
  const mergedStage = {};
  for (const s of Object.keys(dumpStage)) mergedStage[s] = dumpStage[s];
  const stageKeys = [];
  for (const s of Object.keys(oldStage)) {
    if (!mergedStage[s]) mergedStage[s] = oldStage[s];
    stageKeys.push(s);
  }
  for (const s of Object.keys(mergedStage).sort()) {
    if (!stageKeys.includes(s)) stageKeys.push(s);
  }

  // Order styles by the existing styleOrder where possible.
  const order = [];
  for (const s of (OLD.styleOrder || [])) if (dumpStyles.includes(s)) order.push(s);
  for (const s of dumpStyles) if (!order.includes(s)) order.push(s);

  const stylesOut = order.map((s) => styleBlock(s, mergedStyles[s]));
  for (const s of siteOnlyStyles) {
    stylesOut.push("// site-only fallback: not present in the live module's Styles table\n" + styleBlock(s, OLD.styles[s]));
  }

  const scalingOut = [];
  for (const s of dumpScaling) scalingOut.push(scalingLine(s, mergedScaling[s]));
  for (const s of siteOnlyScaling) {
    scalingOut.push("// site-only: not present in the live module's SkillScaling table\n" + scalingLine(s, OLD.skillScaling[s]));
  }

  const skillsOut = [];
  for (const s of dumpSkills) skillsOut.push(skillLine(s, mergedSkills[s]));
  for (const s of siteOnlySkills) {
    skillsOut.push("// site-only: not present in the live module's Skills table\n" + skillLine(s, OLD.skills[s]));
  }

  const stageOut = [];
  for (const s of stageKeys) {
    const e = mergedStage[s];
    stageOut.push(("    " + s + ":").padEnd(22) + " { hits: " + e.hits + ", sum: " + e.sum + " },");
  }

  // spliceBetween removes everything up to the next section's comment, including
  // the "  }," that closes the block, so re-append it after each replacement.
  text = spliceBetween(text, "  styles: {", "  // -- CombatCalcsData.SkillScaling --", stylesOut.join("\n") + "\n  },", "styles");
  text = spliceBetween(text, "  skillScaling: {", "  // -- CombatCalcsData.Skills (key -> entry", scalingOut.join("\n") + "\n  },", "skillScaling");
  text = spliceBetween(text, "  skills: {", "  // Hits + total damage-ratio multiplier per skill", skillsOut.join("\n") + "\n  },", "skills");
  if (Object.keys(dumpStage).length) {
    text = spliceBetween(text, "  stageData: {", "  // For bot-only skills that lack a style mapping", stageOut.join("\n") + "\n  },", "stageData");
    text = text.replace(
      /  \/\/ Hits \+ total damage-ratio multiplier per skill[\s\S]*?(?=  stageData: \{)/,
      "  // Hits + total damage-ratio multiplier per skill, read from the live\n" +
      "  // SkillReg.<Skill> modules (Stages + FinalDamage/DealDamage usage; hit-count\n" +
      "  // source of truth). hits = DealDamage applications per Activate, sum = total\n" +
      "  // damage-ratio multiplier dealt (Σ per application). Total skill damage = per-hit\n" +
      "  // damage × sum. The \"hits\" override in the UI simulates N hits of DamageRatio 1 each.\n"
    );
  }

  // Bump the data version.
  text = text.replace(/(DATA_VERSION: ")[^"]+(")/, "$1" + version + "$2");
  text = text.replace(
    /(Exported: )[^\n]+/,
    "$1" + version + " (from live CombatCalcsData, studio place [KickBoxing] Hyaku Asura)"
  );

  if (dry) {
    console.log("-- dry run: " + dumpStyles.length + " styles, " + dumpScaling.length + " scaling entries, " +
      dumpSkills.length + " skills; site-only kept: " + siteOnlyStyles.join(",") + " / " + siteOnlySkills.join(","));
    process.exit(0);
  }

  fs.writeFileSync(DATA_FILE, text);

  // ---- verification -----------------------------------------------------------
  delete global.window;
  global.window = {};
  vm.runInThisContext(text, { filename: DATA_FILE });
  const D = global.window.HYAKU_DATA;
  const problems = [];
  const deepEq = (a, b, where) => {
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 1e-9) problems.push(where + ": " + a + " != " + b);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) { problems.push(where + ": array length"); return; }
      for (let i = 0; i < a.length; i++) deepEq(a[i], b[i], where + "[" + i + "]");
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of Object.keys(a)) {
        if (b[k] === undefined) problems.push(where + "." + k + ": missing");
        else deepEq(a[k], b[k], where + "." + k);
      }
      return;
    }
    if (a !== b) problems.push(where + ": " + a + " != " + b);
  };

  for (const s of dumpStyles) deepEq(dump.Styles[s], D.styles[s], "Styles." + s);
  for (const s of dumpScaling) deepEq(dump.SkillScaling[s], D.skillScaling[s], "SkillScaling." + s);
  for (const s of dumpSkills) deepEq(dump.Skills[s], D.skills[s], "Skills." + s);
  for (const s of Object.keys(dumpStage)) {
    deepEq(dumpStage[s].hits, D.stageData[s].hits, "stageData." + s + ".hits");
    deepEq(dumpStage[s].sum, D.stageData[s].sum, "stageData." + s + ".sum");
  }

  if (problems.length) {
    console.log("Verification failed (" + problems.length + "):");
    for (const p of problems.slice(0, 40)) console.log("  " + p);
    process.exit(1);
  }

  console.log("Exported " + dumpStyles.length + " styles, " + dumpScaling.length + " scaling entries, " +
    dumpSkills.length + " skills, " + Object.keys(dumpStage).length + " stageData entries into data.js (DATA_VERSION -> " + version + ").");
  if (siteOnlyStyles.length) console.log("Kept site-only styles: " + siteOnlyStyles.join(", "));
  if (siteOnlySkills.length) console.log("Kept site-only skills: " + siteOnlySkills.join(", "));
  console.log("Verified: every dump value now matches data.js.");
}

main();
