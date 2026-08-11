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
closeTo(C.EffectiveStat(2000, D.statLimits.Strength), 1150, 1e-6, "EffectiveStat(2000 Str) = 1150");
closeTo(C.EffectiveStat(2000, D.statLimits.Muscle), 1080, 1e-6, "EffectiveStat(2000 Mus) = 1080");

var tm = HU.getStyle("The_Middle");
var stats = HU.state.stats; // default balanced build
var m1 = C.ComputeM1Damage({ style: tm, stats: stats, basicAttackDmg: 1 });
var m2 = C.ComputeM2Damage({ style: tm, stats: stats, criticalDmg: 1 });
closeTo(m1, 216.7264, 0.02, "The_Middle M1 = 216.7264");
closeTo(m2, 242.733568, 0.02, "The_Middle M2 = 242.733568");

// Skill parity anchors, captured live from CombatCalculation 2026-08-11 at the
// default build. Legacy styles (Street_Fighter/KJ/Boxing) resolve to nil and
// fall back to 0.75 * SkillBonus in both the game and the site.
closeTo(C.SkillStatMultiplier(null, stats), 4.5, 1e-9, "SkillStatMultiplier(nil) = 4.5 (legacy fallback)");
var skillCases = [
  ["Payback (The_Middle)", "The_Middle", 13.5, 217.4439792857143],
  ["Cranium_Break (Demon_Fist)", "Demon_Fist", 30, 474.72859285714289],
  ["Avidya (Kure)", "Kure", 13.5, 198.56462946428574],
  ["Hadouken (Street_Fighter legacy)", "Street_Fighter", 14.5, 65.25],
  ["Ravage (KJ legacy)", "KJ", 23, 103.5],
];
skillCases.forEach(function (c) {
  closeTo(C.ComputeSkillDamage({ power: c[2], skill: { Style: c[1] }, stats: stats }), c[3], 1e-9, "ComputeSkillDamage " + c[0] + " = " + c[3]);
});

// Aux formulas, captured live from CombatCalculation 2026-08-11 at the default
// build (GetM1StamDrain/GetM2StamDrain, GetHitCountDamageDecay curve, defenses,
// ScaleGetASMultiplier at the lean profile P3, block/run drains, rhythm/landed).
closeTo(C.GetStamDrain({ style: tm, stats: stats, attack: "M1" }), 6.326666666666666, 1e-9, "GetStamDrain M1 (The_Middle) = 6.326666666666666");
closeTo(C.GetStamDrain({ style: tm, stats: stats, attack: "M2" }), 10.853333333333334, 1e-9, "GetStamDrain M2 (The_Middle) = 10.853333333333334");
[10, 19, 50].forEach(function (n, i) {
  closeTo(C.GetHitCountDamageDecay(n), [0.92, 0.84, 0.6][i], 1e-9, "GetHitCountDamageDecay(" + n + ") = " + [0.92, 0.84, 0.6][i]);
});
closeTo(C.GetDurabilityDefense(stats), 0.29411764705882356, 1e-9, "GetDurabilityDefense(P1) = 0.29411764705882356");
closeTo(C.GetMuscleDefense(stats), 0.06, 1e-9, "GetMuscleDefense(P1) = 0.06");
closeTo(C.GetFatDefense(stats), 0.0135, 1e-9, "GetFatDefense(P1) = 0.0135");
closeTo(C.GetBlockHitStamDrain({ stats: stats, damage: 100 }), 5.635, 1e-9, "GetBlockHitStamDrain(P1, 100dmg) = 5.635");
closeTo(C.GetRunStamDrain({ stats: stats, deltaTime: 1 / 60, boosted: false }), 0.02729166666666667, 1e-9, "GetRunStamDrain(P1) = 0.02729166666666667");
var leanStats = { Strength: 800, Muscle: 150, Fat: 50, Agility: 600, AttackSpeed: 500, Durability: 300, MaxStamina: 100, StaminaInStat: 500 };
closeTo(C.ScaleGetASMultiplier({ style: tm, stats: leanStats, isM2: false, attributes: {} }), 1.4182109391185845, 1e-9, "ScaleGetASMultiplier The_Middle P3 = 1.4182109391185845");
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
