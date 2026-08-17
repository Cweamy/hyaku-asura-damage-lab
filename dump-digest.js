#!/usr/bin/env node
// ============================================================================
// dump-digest.js — local half of the drift check against live Studio data.
//
// `studio-dump.luau` with MODE = "digest" prints one `Section.Name=hash` line
// per entry of the live CombatCalcsData. This prints the same lines for the
// local snapshot, so you can tell what actually drifted without shipping the
// whole 50 KB dump around.
//
// Usage:
//   node dump-digest.js                          # digest of combat-calcs-data.dump.json
//   node dump-digest.js --data                   # digest of data.js instead
//   node dump-digest.js --compare live.txt       # diff live digest vs local
//
// Exit code is 1 when --compare finds drift, so it can gate a re-export.
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SECTIONS = ["Styles", "SkillScaling", "Skills"];

// ---- canonical form (must match studio-dump.luau exactly) -------------------

function fmtValue(v) {
  if (typeof v === "number") {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function flatten(obj, prefix, out) {
  // Lua sorts array indices as strings too ("1" < "10" < "2"); mirror that.
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const v = obj[k];
    // Lua tables are 1-based; a JS array index 0 is Lua index 1.
    const luaKey = Array.isArray(obj) ? String(Number(k) + 1) : k;
    const key = prefix === "" ? luaKey : prefix + "." + luaKey;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else out.push(key + "=" + fmtValue(v));
  }
}

function canonical(entry) {
  if (entry === null || typeof entry !== "object") return fmtValue(entry);
  const parts = [];
  flatten(entry, "", parts);
  // Array keys were sorted numerically above but Lua sorts them as strings.
  return parts.sort().join(",");
}

function fnv1a(s) {
  // Lua walks the string byte by byte, so hash UTF-8 bytes — not UTF-16 code
  // units, which would disagree on any non-ASCII value (e.g. "Avidyā").
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

// ---- sources ----------------------------------------------------------------

function loadDump() {
  const file = path.join(__dirname, "combat-calcs-data.dump.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadDataJs() {
  const src = fs.readFileSync(path.join(__dirname, "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "data.js" });
  const D = sandbox.window.HYAKU_DATA;
  // data.js uses lowercase section keys.
  return { Styles: D.styles, SkillScaling: D.skillScaling, Skills: D.skills };
}

function digestOf(source) {
  const lines = [];
  for (const section of SECTIONS) {
    const tbl = source[section] || {};
    for (const name of Object.keys(tbl).sort()) {
      lines.push(section + "." + name + "=" + fnv1a(canonical(tbl[name])));
    }
  }
  return lines;
}

// ---- compare ----------------------------------------------------------------

function parseDigest(text) {
  const map = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("--")) continue;
    const i = line.lastIndexOf("=");
    if (i === -1) continue;
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

function main() {
  const argv = process.argv.slice(2);
  const useData = argv.includes("--data");
  const cmpIdx = argv.indexOf("--compare");

  const local = digestOf(useData ? loadDataJs() : loadDump());

  if (cmpIdx === -1) {
    console.log(local.join("\n"));
    return;
  }

  const file = argv[cmpIdx + 1];
  if (!file) {
    console.error("ERROR: --compare needs a file containing the live digest output");
    process.exit(2);
  }
  const live = parseDigest(fs.readFileSync(file, "utf8"));
  const mine = parseDigest(local.join("\n"));

  const changed = [];
  const onlyLive = [];
  const onlyLocal = [];
  for (const [k, v] of live) {
    if (!mine.has(k)) onlyLive.push(k);
    else if (mine.get(k) !== v) changed.push(k);
  }
  for (const k of mine.keys()) if (!live.has(k)) onlyLocal.push(k);

  const label = useData ? "data.js" : "combat-calcs-data.dump.json";
  console.log("live entries: " + live.size + "   " + label + " entries: " + mine.size);
  if (!changed.length && !onlyLive.length && !onlyLocal.length) {
    console.log("IN SYNC — every entry hashes identically.");
    return;
  }
  if (changed.length) console.log("\nCHANGED (" + changed.length + "):\n  " + changed.sort().join("\n  "));
  if (onlyLive.length) console.log("\nONLY IN STUDIO (" + onlyLive.length + "):\n  " + onlyLive.sort().join("\n  "));
  if (onlyLocal.length) console.log("\nONLY LOCALLY (" + onlyLocal.length + "):\n  " + onlyLocal.sort().join("\n  "));
  console.log("\nRe-export: run studio-dump.luau with MODE = \"json\", save as " +
    "combat-calcs-data.dump.json, then `node export-data.js combat-calcs-data.dump.json`.");
  process.exit(1);
}

main();
