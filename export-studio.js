#!/usr/bin/env node
// ============================================================================
// export-studio.js — CLI wrapper around studio-export.js.
//
// Takes a Balance Lab share config and writes the Studio change request: the
// instruction prompt, the exact Studio paths with live/requested values, the
// expected damage impact, and a JSON payload.
//
// Usage:
//   node export-studio.js "<base64url share code>"
//   node export-studio.js path/to/config.json
//   node export-studio.js '<raw JSON>'
//   node export-studio.js <config> -o studio-change-request.md   # write to file
//
// The same document is available in the browser from the Balance Lab's
// "Copy Studio change request" button — this exists for share links pasted into
// a terminal, and for wiring into a script.
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const buildDocument = require("./studio-export.js").buildDocument;

// Local date, not UTC — a brief generated in the evening should not be stamped
// with tomorrow's (or yesterday's) date relative to the changelog entries.
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function fail(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}

function decodeConfig(arg) {
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, "utf8"));
  if (arg.trim().startsWith("{")) return JSON.parse(arg);
  const b64 = arg.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

function loadSite() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const file of ["data.js", "calc.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), sandbox, { filename: file });
  }
  return { data: sandbox.window.HYAKU_DATA, calc: sandbox.window.HyakuCalc };
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.log("Usage: node export-studio.js <share-code|config.json|json> [-o out.md]");
    process.exit(0);
  }

  let cfg;
  try {
    cfg = decodeConfig(argv[0]);
  } catch (err) {
    fail("could not read the config (" + err.message + "). Pass a share code, a .json path, or raw JSON.");
  }

  const site = loadSite();
  const doc = buildDocument(cfg, {
    data: site.data,
    calc: site.calc,
    date: localDate(),
  });

  const outIdx = argv.indexOf("-o");
  if (outIdx !== -1) {
    const out = argv[outIdx + 1];
    if (!out) fail("-o needs a filename");
    fs.writeFileSync(out, doc);
    console.log("Wrote " + out + " (" + doc.split("\n").length + " lines).");
    return;
  }
  process.stdout.write(doc + "\n");
}

main();
