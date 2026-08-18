// ============================================================================
// Hyaku Asura — Damage Lab · smoke + data-integrity tests
// Run:  node test.js   (or: npm test)
//
// Loads data.js + calc.js + util.js in a Node sandbox (no DOM) and checks:
//   1. calc parity against live-verified values (README spot-checks + 2026-08-11
//      re-verified anchors after the statLimits re-sync; see BALANCE_CHANGELOG.md)
//   2. structural data integrity (orphan skillScaling / styleOrder refs)
//   3. reports data-health warnings (missing styles / missing stageData)
//
// Fails (exit 1) on any broken structural invariant or parity mismatch, so a
// re-exported data.js that drifts away from calc.js is caught in CI, not in a
// user's browser.
// ============================================================================
"use strict";

var fs = require("fs");
var path = require("path");

var root = __dirname;

function load(fn) {
  var src = fs.readFileSync(path.join(root, fn), "utf8");
  // data.js / calc.js / util.js attach to `window`; render.js/app.js need DOM.
  (new Function("window", "self", src))(window, window);
}

var failures = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓ " + msg); }
  else { failures++; console.error("  ✗ FAIL: " + msg); }
}
function closeTo(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, msg + " (got " + a.toFixed(4) + ", expected ~" + b + ")");
}

// ---- sandbox window ----
global.window = {};
global.self = global.window;

load("data.js");
load("calc.js");
load("util.js");

var D = window.HYAKU_DATA;
var C = window.HyakuCalc;
var HU = window.HU;

console.log("\nHyaku Asura — Damage Lab tests\n");

// 1. calc parity
console.log("Calc parity:");
ok(!!D.DATA_VERSION, "data has DATA_VERSION (" + D.DATA_VERSION + ")");
ok(!!C, "HyakuCalc loaded");
closeTo(C.EffectiveStat(2000, D.statLimits.Strength), 1725, 1e-6, "EffectiveStat(2000 Str) = 1725");
closeTo(C.EffectiveStat(2000, D.statLimits.Muscle), 1400, 1e-6, "EffectiveStat(2000 Mus) = 1400");

var tm = HU.getStyle("The_Middle");
var stats = HU.state.stats; // default balanced build
var m1 = C.ComputeM1Damage({ style: tm, stats: stats, basicAttackDmg: 1 });
var m2 = C.ComputeM2Damage({ style: tm, stats: stats, criticalDmg: 1 });
closeTo(m1, 234.7591275, 0.02, "The_Middle M1 = 234.7591275");
closeTo(m2, 262.9302228, 0.02, "The_Middle M2 = 262.9302228");

// M1/M2 anchors above re-verified against the live CombatCalculation on
// 2026-08-18 after the style balance pass (The_Middle muscle scaling changed).
// Skill parity anchors, verified against the live module on 2026-08-15 at the
// default build; re-verified on 2026-08-17 after the balance pass (4 skills
// re-anchored to post-pass scaling). Each case uses the live skill entry and
// skill-specific scaling.
closeTo(C.SkillStatMultiplier(null, stats), 4.5, 1e-9, "SkillStatMultiplier(nil) = 4.5 (legacy fallback)");
var skillCases = [
  ["Payback", 245.991156525],
  ["Cranium_Break", 410.85225],
  ["Avidya", 144.96559875],
  ["Hadouken", 277.449975],
  ["Ravage", 504.3796875],
];
skillCases.forEach(function (c) {
  closeTo(C.ComputeSkillDamage({ skillName: c[0], skill: D.skills[c[0]], stats: stats }), c[1], 1e-9, "ComputeSkillDamage " + c[0] + " = " + c[1]);
});

// Aux formulas, verified against the live module on 2026-08-15 at the default
// build (GetM1StamDrain/GetM2StamDrain, GetHitCountDamageDecay curve, defenses,
// ScaleGetASMultiplier at the lean profile P3, block/run drains, rhythm/landed).
closeTo(C.GetStamDrain({ style: tm, stats: stats, attack: "M1" }), 140, 1e-9, "GetStamDrain M1 (The_Middle) = 140");
closeTo(C.GetStamDrain({ style: tm, stats: stats, attack: "M2" }), 147, 1e-9, "GetStamDrain M2 (The_Middle) = 147");
// Re-anchored 2026-08-18 from the live module: the decay free-window is 5 hits,
// not 14, so 10 hits already sits in tier 1 (0.95).
[10, 19, 50].forEach(function (n, i) {
  closeTo(C.GetHitCountDamageDecay(n), [0.95, 0.9, 0.75][i], 1e-9, "GetHitCountDamageDecay(" + n + ") = " + [0.95, 0.9, 0.75][i]);
});
closeTo(C.GetDurabilityDefense(stats), 0.29411764705882356, 1e-9, "GetDurabilityDefense(P1) = 0.29411764705882356");
closeTo(C.GetMuscleDefense(stats), 0.06, 1e-9, "GetMuscleDefense(P1) = 0.06");
closeTo(C.GetFatDefense(stats), 0.0135, 1e-9, "GetFatDefense(P1) = 0.0135");
// Re-anchored 2026-08-18: live block drain constants are 0.12 / 0.40 (were 0.18 / 0.49).
closeTo(C.GetBlockHitStamDrain({ stats: stats, damage: 100 }), 3.16, 1e-9, "GetBlockHitStamDrain(P1, 100dmg) = 3.16");
closeTo(C.GetRunStamDrain({ stats: stats, deltaTime: 1 / 60, boosted: false }), 0.02729166666666667, 1e-9, "GetRunStamDrain(P1) = 0.02729166666666667");
var leanStats = { Strength: 800, Muscle: 150, Fat: 50, Agility: 600, AttackSpeed: 500, Durability: 300, MaxStamina: 100, StaminaInStat: 500 };
closeTo(C.ScaleGetASMultiplier({ style: tm, stats: leanStats, isM2: false, attributes: {} }), 1.0629886500857986, 1e-9, "ScaleGetASMultiplier The_Middle P3 = 1.0629886500857986");
closeTo(C.GetRhythmStamMul(50), 0.85, 1e-9, "GetRhythmStamMul(50) = 0.85");
closeTo(C.GetSkillLandedStamMul(), 0.7, 1e-9, "GetSkillLandedStamMul() = 0.7");

// 2. structural integrity (hard failures)
console.log("\nStructural integrity:");
var styles = new Set(Object.keys(D.styles || {}));
var orphanScaling = Object.keys(D.skillScaling || {}).filter(function (k) { return !(D.skills || {})[k]; });
ok(orphanScaling.length === 0, "no orphan skillScaling keys (got " + orphanScaling.length + ": " + orphanScaling.join(", ") + ")");

var orderMissing = (D.styleOrder || []).filter(function (s) { return !styles.has(s); });
ok(orderMissing.length === 0, "styleOrder fully resolves (got " + orderMissing.length + ": " + orderMissing.join(", ") + ")");

// 2b. live-module dump parity: every field the dump carries must appear in data.js
// with an equal value (dump = combat-calcs-data.dump.json, exported from the live
// CombatCalcsData module). Catches a re-export that drops or renames fields.
console.log("\nLive-module dump parity (combat-calcs-data.dump.json):");
var dump = require("./combat-calcs-data.dump.json");
var dumpSkills = Object.keys(dump.Skills || {});
var dumpBad = 0;
function sdVal(skill, key) {
  var sd = skill.SkillData || {};
  var v = sd[key];
  if (v != null && typeof v === "object" && "Base" in v) return v.Base;
  return v;
}
dumpSkills.forEach(function (name) {
  var dsk = dump.Skills[name];
  var s = D.skills[name];
  if (!s) { dumpBad++; console.log("  ✗ MISSING SKILL: " + name); return; }
  ["Cooldown", "Style", "DisplayName"].forEach(function (f) {
    if (s[f] !== dsk[f]) { dumpBad++; console.log("  ✗ " + name + "." + f + ": data=" + s[f] + " dump=" + dsk[f]); }
  });
  ["Cooldown", "Power", "Range", "Speed"].forEach(function (f) {
    var a = sdVal(s, f), b = sdVal(dsk, f);
    if (Math.abs(a - b) > 1e-9) { dumpBad++; console.log("  ✗ " + name + ".SkillData." + f + ": data=" + a + " dump=" + b); }
  });
});
ok(dumpBad === 0, "all " + dumpSkills.length + " dump skills match data.js field-for-field (incl. SkillData)");

// 3. data-health warnings (reported; drives the on-page health bar)
console.log("\nData health warnings:");
var warnings = HU.verifyData();
if (warnings.length === 0) {
  console.log("  ✓ none — data verified clean");
} else {
  warnings.forEach(function (w) { console.log("  ! " + w); });
}

console.log("\n" + (failures === 0 ? "All tests passed." : failures + " check(s) failed.") + "\n");
process.exit(failures === 0 ? 0 : 1);
