// ============================================================================
// Hyaku Asura — Damage Lab · smoke + data-integrity tests
// Run:  node test.js   (or: npm test)
//
// Loads data.js + calc.js + util.js in a Node sandbox (no DOM) and checks:
//   1. calc parity against known-good values (mirrors the README spot-checks)
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

var tm = HU.getStyle("The_Middle");
var stats = HU.state.stats; // default balanced build
var m1 = C.ComputeM1Damage({ style: tm, stats: stats, basicAttackDmg: 1 });
var m2 = C.ComputeM2Damage({ style: tm, stats: stats, criticalDmg: 1 });
closeTo(m1, 277.40, 0.02, "The_Middle M1 = 277.40");
closeTo(m2, 310.68, 0.02, "The_Middle M2 = 310.68");

// 2. structural integrity (hard failures)
console.log("\nStructural integrity:");
var styles = new Set(Object.keys(D.styles || {}));
var orphanScaling = Object.keys(D.skillScaling || {}).filter(function (k) { return !(D.skills || {})[k]; });
ok(orphanScaling.length === 0, "no orphan skillScaling keys (got " + orphanScaling.length + ": " + orphanScaling.join(", ") + ")");

var orderMissing = (D.styleOrder || []).filter(function (s) { return !styles.has(s); });
ok(orderMissing.length === 0, "styleOrder fully resolves (got " + orderMissing.length + ": " + orderMissing.join(", ") + ")");

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
