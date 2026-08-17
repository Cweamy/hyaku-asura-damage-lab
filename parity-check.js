#!/usr/bin/env node
// ============================================================================
// parity-check.js — local half of the calc.js ⇄ CombatCalculation parity sweep.
//
// `parity-sweep.luau` runs the same matrix through the LIVE module in Studio.
// This runs it through calc.js and either prints a comparable hash, or diffs
// row by row against the live output.
//
// Usage:
//   node parity-check.js                     # rows=<n> hash=<h>   (compare by eye)
//   node parity-check.js --rows              # dump every row
//   node parity-check.js --live live.txt     # diff against a "rows" mode dump
//
// Values are compared as round(value * 1e6) integers so both languages agree
// exactly without depending on float-to-string formatting. Exit code 1 on drift.
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Profiles must stay identical to PROFILES in parity-sweep.luau.
const PROFILES = [
  { name: "P1", stats: { Strength: 2000, Muscle: 2000, Fat: 300, Agility: 1000, AttackSpeed: 1000, Durability: 1000, StaminaInStat: 1000, MaxStamina: 100 } },
  { name: "P2", stats: { Strength: 4000, Muscle: 3500, Fat: 1200, Agility: 400, AttackSpeed: 300, Durability: 2500, StaminaInStat: 2000, MaxStamina: 150 } },
];

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ["data.js", "calc.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), sandbox, { filename: file });
}
const D = sandbox.window.HYAKU_DATA;
const C = sandbox.window.HyakuCalc;

const rows = [];
function row(key, value) {
  rows.push(key + "\t" + String(Math.floor((value || 0) * 1e6 + 0.5)));
}

const styleNames = Object.keys(D.styles).sort();
const skillNames = Object.keys(D.skills).sort();

for (const profile of PROFILES) {
  const P = profile.name;
  const stats = profile.stats;

  for (const stat of ["Strength", "Muscle", "Fat"]) {
    row("EffStat/" + stat + "/" + P, C.EffectiveStat(stats[stat], D.statLimits[stat]));
  }
  row("StrEff/" + P, C.GetStrengthEffectiveness(stats.Muscle));

  for (const name of styleNames) {
    const style = D.styles[name];
    row("M1/" + name + "/" + P, C.ComputeM1Damage({ style: style, stats: stats, basicAttackDmg: 1 }));
    row("M2/" + name + "/" + P, C.ComputeM2Damage({ style: style, stats: stats, criticalDmg: 1 }));
    row("DrainM1/" + name + "/" + P, C.GetStamDrain({ style: style, stats: stats, attack: "M1" }));
    row("DrainM2/" + name + "/" + P, C.GetStamDrain({ style: style, stats: stats, attack: "M2" }));
    row("AS1/" + name + "/" + P, C.ScaleGetASMultiplier({ style: style, stats: stats, isM2: false, attributes: {} }));
    row("AS2/" + name + "/" + P, C.ScaleGetASMultiplier({ style: style, stats: stats, isM2: true, attributes: {} }));
  }

  for (const name of skillNames) {
    // See parity-sweep.luau: Block's SkillData.Power is { Base, Affect }, a path the
    // live game never evaluates, so it is skipped on both sides.
    const entry = D.skills[name];
    if (entry.SkillData && typeof entry.SkillData.Power === "number") {
      row("Skill/" + name + "/" + P, C.ComputeSkillDamage({ skillName: name, skill: entry, stats: stats }));
    }
  }

  row("DefDur/" + P, C.GetDurabilityDefense(stats));
  row("DefMus/" + P, C.GetMuscleDefense(stats));
  row("DefFat/" + P, C.GetFatDefense(stats));
  row("BlockDrain/" + P, C.GetBlockHitStamDrain({ stats: stats, damage: 100 }));
  row("RunDrain/" + P, C.GetRunStamDrain({ stats: stats, deltaTime: 1 / 60, boosted: false }));
  row("RunDrainBoost/" + P, C.GetRunStamDrain({ stats: stats, deltaTime: 1 / 60, boosted: true }));
  row("ASProgress/" + P, C.GetAttackSpeedProgress(stats.AttackSpeed));
  row("ASStun/" + P, C.GetAttackSpeedStunMultiplier(stats));
}

for (const n of [1, 5, 9, 10, 15, 19, 20, 28, 37, 46, 50, 80]) row("Decay/" + n, C.GetHitCountDamageDecay(n));
for (const n of [1, 2, 3, 4, 6]) row("MultiStun/" + n, C.GetMultiAttackerStunMultiplier(n));
for (const n of [0, 25, 50, 75, 100]) row("Rhythm/" + n, C.GetRhythmStamMul(n));
row("SkillLanded", C.GetSkillLandedStamMul());
row("SkillMulNil", C.SkillStatMultiplier(null, PROFILES[0].stats));

const text = rows.join("\n");

function fnv1a(s) {
  const bytes = Buffer.from(s, "utf8");
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    const lo = h & 0xffff;
    const hi = (h >>> 16) & 0xffff;
    h = ((lo * 16777619 + (((hi * 16777619) & 0xffff) << 16)) >>> 0);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const argv = process.argv.slice(2);
if (argv.includes("--rows")) {
  console.log(text);
  process.exit(0);
}

const liveIdx = argv.indexOf("--live");
if (liveIdx === -1) {
  console.log("rows=" + rows.length + " hash=" + fnv1a(text));
  process.exit(0);
}

const liveFile = argv[liveIdx + 1];
if (!liveFile) {
  console.error("ERROR: --live needs the file holding parity-sweep.luau's \"rows\" output");
  process.exit(2);
}

const live = new Map();
for (const raw of fs.readFileSync(liveFile, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("--") || line.startsWith("rows=")) continue;
  const [k, v] = line.split("\t");
  if (k && v !== undefined) live.set(k, Number(v));
}

const mine = new Map(rows.map((r) => { const [k, v] = r.split("\t"); return [k, Number(v)]; }));
const drift = [];
const onlyLive = [];
const onlyMine = [];
for (const [k, v] of live) {
  if (!mine.has(k)) onlyLive.push(k);
  else if (mine.get(k) !== v) drift.push({ key: k, live: v / 1e6, site: mine.get(k) / 1e6 });
}
for (const k of mine.keys()) if (!live.has(k)) onlyMine.push(k);

console.log("live rows: " + live.size + "   calc.js rows: " + mine.size);
if (!drift.length && !onlyLive.length && !onlyMine.length) {
  console.log("PARITY OK — every formula matches the live module.");
  process.exit(0);
}
if (drift.length) {
  console.log("\nDRIFT (" + drift.length + "):");
  for (const d of drift.slice(0, 60)) {
    console.log("  " + d.key + ": live=" + d.live + "  site=" + d.site + "  (Δ " + (d.site - d.live).toFixed(6) + ")");
  }
  if (drift.length > 60) console.log("  … " + (drift.length - 60) + " more");
}
if (onlyLive.length) console.log("\nONLY IN STUDIO (" + onlyLive.length + "): " + onlyLive.slice(0, 20).join(", "));
if (onlyMine.length) console.log("\nONLY IN calc.js (" + onlyMine.length + "): " + onlyMine.slice(0, 20).join(", "));
process.exit(1);
