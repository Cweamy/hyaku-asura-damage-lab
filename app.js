// ============================================================================
// Hyaku Asura — Damage Lab · application glue
// Owns state transitions, event wiring, share-code encode/decode, presets, the
// sticky section navigation with scroll-spy, and Balance Lab actions. All DOM
// output goes through HU.render; all shared logic lives in HU (util.js).
// ============================================================================
window.HU.app = (function () {
  "use strict";

  var HU = window.HU;
  var DATA = HU.DATA, Calc = HU.Calc, state = HU.state;
  var esc = HU.esc, fmt = HU.fmt, numOr = HU.numOr, styleLabel = HU.styleLabel;
  var $ = function (id) { return document.getElementById(id); };
  var render = HU.render;

  var PRESETS = [
    { name: "Balanced", stats: { Strength: 2000, Muscle: 2000, Fat: 300, Agility: 1000, AttackSpeed: 1000, Durability: 1000, StaminaInStat: 1000, MaxStamina: 100 } },
    { name: "Pure Strength", stats: { Strength: 4500, Muscle: 500, Fat: 0, Agility: 500, AttackSpeed: 500, Durability: 500, StaminaInStat: 500, MaxStamina: 100 } },
    { name: "Brawny", stats: { Strength: 3000, Muscle: 3000, Fat: 1000, Agility: 500, AttackSpeed: 500, Durability: 2000, StaminaInStat: 1000, MaxStamina: 100 } },
    { name: "Tank", stats: { Strength: 1000, Muscle: 3000, Fat: 2000, Agility: 500, AttackSpeed: 500, Durability: 4500, StaminaInStat: 2000, MaxStamina: 150 } },
    { name: "Speedster", stats: { Strength: 1000, Muscle: 500, Fat: 0, Agility: 2500, AttackSpeed: 3000, Durability: 500, StaminaInStat: 2000, MaxStamina: 120 } },
  ];

  var NAV = [
    { id: "player-card", label: "Player" },
    { id: "matrix-card", label: "Matrix" },
    { id: "style-card", label: "Style" },
    { id: "skills-card", label: "Skills" },
    { id: "compare-card", label: "Compare" },
    { id: "balance-card", label: "Balance" },
    { id: "analysis-card", label: "Analysis" },
    { id: "share-card", label: "Share" },
  ];

  // ---------------- status ----------------

  function status(msg, ok) {
    var el = $("status");
    el.textContent = msg;
    el.className = "status " + (ok === false ? "err" : ok ? "ok" : "");
    clearTimeout(status._t);
    status._t = setTimeout(function () { el.textContent = ""; el.className = "status"; }, 4000);
  }

  // ---------------- share codes ----------------

  function toBase64Url(str) {
    var b = btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(str) {
    var b = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }

  function buildConfig() {
    return {
      v: 1,
      stats: state.stats,
      mults: state.mults,
      scn: state.scn,
      ana: state.ana,
      style: state.style,
      over: state.overrides,
      sover: state.styleOverrides,
      list: state.compare,
      bal: state.balSkill,
    };
  }

  function sanitizeAna(ana) {
    var a = Object.assign({}, HU.DEFAULT_ANA, ana || {});
    a.hp = Math.max(0, Number(a.hp) || 100);
    a.def = Math.min(95, Math.max(0, Number(a.def) || 0));
    a.budget = Math.max(0, Number(a.budget) || 0);
    if (a.target !== "M1" && a.target !== "M2" && !DATA.skills[a.target]) a.target = "M1";
    if (HU.ANA_TABS.indexOf(a.tab) === -1) a.tab = "dps";
    return a;
  }

  function sanitizeOverrides(over) {
    var out = {};
    Object.keys(over).forEach(function (k) {
      if (!DATA.skills[k]) return;
      var o = over[k];
      if (!o || typeof o !== "object") return;
      var c = {};
      Object.keys(HU.SD_FIELDS).forEach(function (f) {
        var v = o[f];
        if (v !== "" && v != null && isFinite(Number(v))) c[f] = Number(v);
      });
      if (o.hits !== "" && o.hits != null && isFinite(Number(o.hits))) {
        c.hits = Math.max(1, Math.round(Number(o.hits)));
      }
      if (o.scaling && typeof o.scaling === "object") {
        var s = {};
        HU.SCALING_FIELDS.forEach(function (f) {
          var v = o.scaling[f];
          if (v !== "" && v != null && isFinite(Number(v))) s[f] = Number(v);
        });
        if (Object.keys(s).length) c.scaling = s;
      }
      if (Object.keys(c).length) out[k] = c;
    });
    return out;
  }

  function sanitizeStyleOverrides(sover) {
    var out = {};
    Object.keys(sover).forEach(function (k) {
      if (!DATA.styles[k]) return;
      var o = sover[k];
      if (!o || typeof o !== "object") return;
      var c = {};
      HU.STYLE_EDIT_FIELDS.forEach(function (f) {
        var v = o[f.key];
        if (v !== "" && v != null && isFinite(Number(v))) c[f.key] = Number(v);
      });
      if (Object.keys(c).length) out[k] = c;
    });
    return out;
  }

  function applyConfig(cfg) {
    if (!cfg || cfg.v !== 1) throw new Error("Unsupported config version");
    state.stats = Object.assign({}, HU.DEFAULT_STATS, cfg.stats || {});
    state.mults = Object.assign({}, HU.DEFAULT_MULTS, cfg.mults || {});
    state.scn = Object.assign({}, HU.DEFAULT_SCN, cfg.scn || {});
    state.ana = sanitizeAna(cfg.ana);
    state.style = (cfg.style && DATA.styles[cfg.style]) ? cfg.style : "The_Middle";
    state.overrides = sanitizeOverrides(cfg.over || {});
    state.styleOverrides = sanitizeStyleOverrides(cfg.sover || {});
    state.compare = (cfg.list || []).filter(function (k) { return DATA.skills[k]; });
    state.balSkill = (cfg.bal && DATA.skills[cfg.bal]) ? cfg.bal : "";
  }

  function shareCode() { return toBase64Url(JSON.stringify(buildConfig())); }
  function codeFromString(s) { return fromBase64Url(s.trim()); }

  function setHash(code) {
    try { history.replaceState(null, "", "#cfg=" + code); } catch (e) { /* noop */ }
  }
  function readHash() {
    var m = location.hash.match(/^#cfg=(.+)$/);
    return m ? m[1] : null;
  }

  // ---------------- presets ----------------

  function renderPresets() {
    var bar = $("presetBar");
    bar.innerHTML = "";
    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "btn";
      b.textContent = p.name;
      b.addEventListener("click", function () {
        state.stats = Object.assign({}, p.stats);
        statInputs();
        render.renderAll();
        status("Preset “" + p.name + "” applied.", true);
      });
      bar.appendChild(b);
    });
  }

  // ---------------- input population ----------------

  function statInputs() {
    Object.keys(HU.DEFAULT_STATS).forEach(function (k) {
      $("stat-" + k).value = state.stats[k];
    });
    $("mult-BasicAttackDmg").value = state.mults.BasicAttackDmg;
    $("mult-CriticalDmg").value = state.mults.CriticalDmg;
    $("mult-SkillDmg").value = state.mults.SkillDmg;
    $("scn-HitCount").value = state.scn.HitCount;
    $("scn-Attackers").value = state.scn.Attackers;
    $("scn-Rhythm").value = state.scn.Rhythm;
    $("ana-hp").value = state.ana.hp;
    $("ana-def").value = state.ana.def;
    $("ana-budget").value = state.ana.budget;
    $("anaTarget").value = state.ana.target;
    $("styleSelect").value = state.style;
    var eb = $("editBalance"); if (eb) eb.checked = state.edit;
  }

  // ---------------- event binding ----------------

  function bindStatInputs() {
    Object.keys(HU.DEFAULT_STATS).forEach(function (k) {
      $("stat-" + k).addEventListener("input", function (e) {
        state.stats[k] = numOr(e.target.value, HU.DEFAULT_STATS[k]);
        render.renderAll();
      });
    });
    ["BasicAttackDmg", "CriticalDmg", "SkillDmg"].forEach(function (k) {
      $("mult-" + k).addEventListener("input", function (e) {
        state.mults[k] = numOr(e.target.value, 1);
        render.renderAll();
      });
    });
    ["HitCount", "Attackers", "Rhythm"].forEach(function (k) {
      $("scn-" + k).addEventListener("input", function (e) {
        state.scn[k] = numOr(e.target.value, HU.DEFAULT_SCN[k]);
        render.renderAll();
      });
    });
    $("styleSelect").addEventListener("change", function (e) {
      state.style = e.target.value;
      render.renderAll();
    });
    var eb = $("editBalance");
    if (eb) eb.addEventListener("change", function (e) {
      state.edit = e.target.checked;
      render.renderAll();
    });
    $("skillFilter").addEventListener("change", function (e) {
      state.skillFilter = e.target.value;
      render.renderSkills();
    });
    $("skillSearch").addEventListener("input", function (e) {
      state.skillSearch = e.target.value.toLowerCase();
      render.renderSkills();
    });

    $("anaTarget").addEventListener("change", function (e) {
      state.ana.target = e.target.value;
      render.renderAnalysis();
    });
    $("ana-hp").addEventListener("input", function (e) {
      state.ana.hp = numOr(e.target.value, HU.DEFAULT_ANA.hp);
      render.renderAnalysis();
    });
    $("ana-def").addEventListener("input", function (e) {
      state.ana.def = numOr(e.target.value, 0);
      render.renderAnalysis();
    });
    $("ana-budget").addEventListener("input", function (e) {
      state.ana.budget = numOr(e.target.value, 0);
      render.renderAnalysis();
    });
    $("anaTabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      state.ana.tab = btn.dataset.tab;
      render.renderAnalysis();
    });
  }

  function bindMatrix() {
    $("styleMatrix").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-style]");
      if (!tr) return;
      if (state.style === tr.dataset.style) return;
      state.style = tr.dataset.style;
      $("styleSelect").value = state.style;
      render.renderAll();
    });
  }

  function bindStyleTable() {
    var st = $("styleTable");
    if (!st) return;
    st.addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT" || !input.dataset.stylefield) return;
      var key = input.dataset.stylefield;
      var ov = state.styleOverrides[state.style] || (state.styleOverrides[state.style] = {});
      var v = input.value;
      if (v === "") delete ov[key];
      else ov[key] = numOr(v, 0);
      if (!Object.keys(ov).length) delete state.styleOverrides[state.style];
      render.renderAll();
    });
  }

  function bindSkillsTable() {
    $("skillsTable").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-add]");
      if (!btn) return;
      var k = btn.dataset.add;
      if (state.compare.indexOf(k) === -1) state.compare.push(k);
      render.renderSkills();
      render.renderCompare();
    });

    $("skillsTable").addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT" || !input.dataset.edit) return;
      var k = input.dataset.skill;
      var f = input.dataset.edit;
      var ov = state.overrides[k] || (state.overrides[k] = {});
      var v = input.value;
      if (v === "") delete ov[f];
      else ov[f] = numOr(v, 0);
      if (!Object.keys(ov).length) delete state.overrides[k];
      // Fast in-place refresh of this row's numbers, then a full refresh.
      render.renderSkills();
      render.renderCompare();
      render.renderBalance();
      render.renderAnalysis();
    });
  }

  function bindCompare() {
    $("compareList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-remove]");
      if (!btn) return;
      var k = btn.dataset.remove;
      state.compare = state.compare.filter(function (x) { return x !== k; });
      render.renderSkills();
      render.renderCompare();
    });

    $("compareList").addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT") return;
      var k = input.dataset.skill;
      if (!k) return;
      var ov = state.overrides[k] || (state.overrides[k] = {});
      var v = input.value;
      if (input.dataset.ovfield) {
        if (v === "") delete ov[input.dataset.ovfield];
        else ov[input.dataset.ovfield] = numOr(v, 0);
      } else if (input.dataset.scalingfield) {
        ov.scaling = ov.scaling || {};
        if (v === "") {
          delete ov.scaling[input.dataset.scalingfield];
          if (!Object.keys(ov.scaling).length) delete ov.scaling;
        } else {
          ov.scaling[input.dataset.scalingfield] = numOr(v, 0);
        }
      }
      if (!Object.keys(ov).length) delete state.overrides[k];
      render.renderCompare();
      render.renderSkills();
      render.renderBalance();
      render.renderAnalysis();
    });
  }

  // ---------------- Balance Lab actions ----------------

  function bindBalance() {
    var sel = $("balSkill");
    if (sel) sel.addEventListener("change", function (e) {
      state.balSkill = e.target.value;
      render.renderBalanceSkill();
    });

    var bsel = $("balStyle");
    if (bsel) bsel.addEventListener("change", function (e) {
      state.style = e.target.value;
      var sc = $("styleSelect"); if (sc) sc.value = state.style;
      render.renderAll();
    });

    // skill field inputs (delegated)
    var fields = $("balSkillFields");
    if (fields) fields.addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT") return;
      var k = input.dataset.balskill;
      if (!k) return;
      var ov = state.overrides[k] || (state.overrides[k] = {});
      var v = input.value;
      if (input.dataset.balfield) {
        var f = input.dataset.balfield;
        if (v === "") delete ov[f];
        else ov[f] = numOr(v, 0);
      } else if (input.dataset.balscaling) {
        var sf = input.dataset.balscaling;
        ov.scaling = ov.scaling || {};
        if (v === "") { delete ov.scaling[sf]; if (!Object.keys(ov.scaling).length) delete ov.scaling; }
        else ov.scaling[sf] = numOr(v, 0);
      }
      if (!Object.keys(ov).length) delete state.overrides[k];
      render.renderBalanceSkill();
      render.renderAll();
    });

    // style field inputs
    var sfields = $("balStyleFields");
    if (sfields) sfields.addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT" || !input.dataset.balsfield) return;
      var key = input.dataset.balsfield;
      var ov = state.styleOverrides[state.style] || (state.styleOverrides[state.style] = {});
      var v = input.value;
      if (v === "") delete ov[key];
      else ov[key] = numOr(v, 0);
      if (!Object.keys(ov).length) delete state.styleOverrides[state.style];
      render.renderBalanceStyle();
      render.renderAll();
    });

    // % / reset / clear buttons
    var b1 = $("balSkillP10"); if (b1) b1.addEventListener("click", function () { pctSkill(state.balSkill, 10); });
    var b2 = $("balSkillM10"); if (b2) b2.addEventListener("click", function () { pctSkill(state.balSkill, -10); });
    var b3 = $("balSkillReset"); if (b3) b3.addEventListener("click", function () { resetSkill(state.balSkill); });
    var b4 = $("balSkillClear"); if (b4) b4.addEventListener("click", function () { clearSkills(); });

    var s1 = $("balStyleP10"); if (s1) s1.addEventListener("click", function () { pctStyle(10); });
    var s2 = $("balStyleM10"); if (s2) s2.addEventListener("click", function () { pctStyle(-10); });
    var s3 = $("balStyleReset"); if (s3) s3.addEventListener("click", function () { resetStyle(); });
    var s4 = $("balStyleClear"); if (s4) s4.addEventListener("click", function () { clearStyles(); });

    var g = $("balClearAll"); if (g) g.addEventListener("click", function () {
      state.overrides = {}; state.styleOverrides = {};
      render.renderAll(); status("All balance edits cleared.", true);
    });
  }

  // Scale every editable numeric field of a skill by (1 + pct/100), seeding from
  // the current effective value (override if present, else live).
  function pctSkill(k, pct) {
    if (!k || !DATA.skills[k]) return status("Pick a skill first.", false);
    var live = DATA.skills[k].SkillData || {};
    var ov = state.overrides[k] || (state.overrides[k] = {});
    var map = { power: "Power", cooldown: "Cooldown", range: "Range", speed: "Speed" };
    Object.keys(map).forEach(function (f) {
      var cur = ov[f] != null ? ov[f] : (live[map[f]] != null ? live[map[f]] : 0);
      if (cur > 0) ov[f] = round2(cur * (1 + pct / 100));
    });
    if (DATA.skillScaling[k] || DATA.skills[k].Style) {
      var base = DATA.skillScaling[k] || DATA.styles[DATA.skills[k].Style] || {};
      ov.scaling = ov.scaling || {};
      HU.SCALING_FIELDS.forEach(function (f) {
        var cur = ov.scaling[f] != null ? ov.scaling[f] : (base[f] != null ? base[f] : 0);
        if (cur > 0) ov.scaling[f] = round2(cur * (1 + pct / 100));
      });
      if (!Object.keys(ov.scaling).length) delete ov.scaling;
    }
    render.renderBalanceSkill();
    render.renderAll();
    status("Scaled “" + HU.skillDisplay(k) + "” by " + (pct > 0 ? "+" : "") + pct + "%.", true);
  }

  function resetSkill(k) {
    if (!k) return status("Pick a skill first.", false);
    delete state.overrides[k];
    render.renderBalanceSkill(); render.renderAll();
    status("Reset “" + HU.skillDisplay(k) + "” to live values.", true);
  }
  function clearSkills() {
    state.overrides = {};
    render.renderBalanceSkill(); render.renderAll();
    status("Cleared all skill edits.", true);
  }

  function pctStyle(pct) {
    var live = DATA.styles[state.style] || {};
    var ov = state.styleOverrides[state.style] || (state.styleOverrides[state.style] = {});
    HU.STYLE_EDIT_FIELDS.forEach(function (f) {
      var cur = ov[f.key] != null ? ov[f.key] : (live[f.key] != null ? live[f.key] : 0);
      if (cur > 0) ov[f.key] = round2(cur * (1 + pct / 100));
    });
    render.renderBalanceStyle(); render.renderAll();
    status("Scaled “" + styleLabel(state.style) + "” by " + (pct > 0 ? "+" : "") + pct + "%.", true);
  }
  function resetStyle() {
    delete state.styleOverrides[state.style];
    render.renderBalanceStyle(); render.renderAll();
    status("Reset “" + styleLabel(state.style) + "” to live values.", true);
  }
  function clearStyles() {
    state.styleOverrides = {};
    render.renderBalanceStyle(); render.renderAll();
    status("Cleared all style edits.", true);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ---------------- share buttons ----------------

  function bindShare() {
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve) {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        resolve();
      });
    }
    function doShare() {
      var code = shareCode();
      setHash(code);
      copyText(location.href).then(function () { status("Share link copied to clipboard.", true); },
        function () { status("Link ready — copy it from the address bar.", false); });
    }
    var s = $("btnShare"); if (s) s.addEventListener("click", doShare);
    var hs = $("btnShareHero"); if (hs) hs.addEventListener("click", doShare);

    $("btnCopy").addEventListener("click", function () {
      var code = shareCode();
      setHash(code);
      $("shareText").value = code;
      copyText(code).then(function () { status("Config code copied.", true); },
        function () { status("Code is in the box above — copy manually.", false); });
    });
    $("btnExport").addEventListener("click", function () {
      $("shareText").value = shareCode();
      status("Full config exported to the box.");
    });
    $("btnImport").addEventListener("click", function () {
      try {
        var cfg = JSON.parse(codeFromString($("shareText").value));
        applyConfig(cfg);
        setHash(shareCode());
        syncFromState();
        status("Config imported.", true);
      } catch (err) {
        status("Invalid config code: " + err.message, false);
      }
    });
    $("btnReset").addEventListener("click", function () {
      state.stats = Object.assign({}, HU.DEFAULT_STATS);
      state.mults = Object.assign({}, HU.DEFAULT_MULTS);
      state.scn = Object.assign({}, HU.DEFAULT_SCN);
      state.ana = Object.assign({}, HU.DEFAULT_ANA);
      state.style = "The_Middle";
      state.overrides = {};
      state.styleOverrides = {};
      state.compare = [];
      state.edit = false;
      state.balSkill = "";
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* noop */ }
      syncFromState();
      status("Reset to live game values.", true);
    });
  }

  // ---------------- navigation ----------------

  function buildNav() {
    var nav = $("topnav");
    if (!nav) return;
    nav.innerHTML = NAV.map(function (n) {
      return '<a href="#' + esc(n.id) + '" data-nav="' + esc(n.id) + '">' + esc(n.label) + "</a>";
    }).join("");

    // smooth scroll + close on selection
    nav.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-nav]");
      if (!a) return;
      var target = document.getElementById(a.dataset.nav);
      if (target) { try { target.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (err) { location.hash = a.dataset.nav; } }
      e.preventDefault();
    });
  }

  function scrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll("#topnav a[data-nav]"));
    var onScroll = function () {
      var pos = window.pageYOffset + 90;
      var current = null;
      for (var i = 0; i < NAV.length; i++) {
        var el = document.getElementById(NAV[i].id);
        if (el && el.offsetTop <= pos) current = NAV[i].id;
      }
      if (!current && NAV.length) current = NAV[0].id;
      links.forEach(function (a) {
        a.classList.toggle("active", a.dataset.nav === current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function backToTop() {
    var btn = $("btnTop");
    if (!btn) return;
    var show = function () { btn.classList.toggle("show", window.pageYOffset > 400); };
    btn.addEventListener("click", function () { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); } });
    window.addEventListener("scroll", show, { passive: true });
    show();
  }

  // ---------------- data health ----------------

  function showHealth() {
    var el = $("healthNote");
    if (!el) return;
    var w = HU.verifyData();
    var v = DATA.DATA_VERSION ? DATA.DATA_VERSION : "unknown";
    if (w.length) {
      var list = "<ul>" + w.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      el.innerHTML = '<span class="badge warn">data check</span> <strong>Version ' + esc(v) + "</strong> — " +
        w.length + " warning" + (w.length === 1 ? "" : "s") +
        ' <details class="health-details"><summary>show</summary>' + list + "</details>";
      el.className = "health warn";
    } else {
      el.innerHTML = '<span class="badge ok">ok</span> <strong>Version ' + esc(v) + "</strong> — data verified, all style/skill references resolve.";
      el.className = "health ok";
    }
  }

  // ---------------- sync / boot ----------------

  function syncFromState() {
    statInputs();
    render.renderAll();
  }

  function boot() {
    var code = readHash();
    if (code) {
      try { applyConfig(JSON.parse(codeFromString(code))); }
      catch (e) { console.warn("Bad config in URL:", e); }
    }

    buildNav();
    scrollSpy();
    backToTop();

    // analysis target options
    var at = $("anaTarget");
    [["M1", "M1 attack"], ["M2", "M2 attack"]].forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0]; o.textContent = pair[1]; at.appendChild(o);
    });
    HU.listableSkills().sort(function (a, b) { return HU.skillDisplay(a).localeCompare(HU.skillDisplay(b)); })
      .forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = HU.skillDisplay(k); at.appendChild(o);
      });

    // skill filter options — list every distinct style referenced by a skill,
    // including legacy names (e.g. Boxing, Street_Fighter, KJ) that have skills
    // but no full style entry yet, so nothing is unreachable from the filter.
    var flt = $("skillFilter");
    var withSkills = {};
    HU.listableSkills().forEach(function (k) {
      var s = DATA.skills[k].Style;
      if (s) withSkills[s] = true;
    });
    Object.keys(withSkills).sort(function (a, b) {
      return styleLabel(a).localeCompare(styleLabel(b));
    }).forEach(function (s) {
      var o = document.createElement("option");
      o.value = s; o.textContent = styleLabel(s); flt.appendChild(o);
    });

    renderPresets();
    bindStatInputs();
    bindMatrix();
    bindStyleTable();
    bindSkillsTable();
    bindCompare();
    bindBalance();
    bindShare();
    showHealth();
    syncFromState();
  }

  return {
    boot: boot,
    shareCode: shareCode,
    applyConfig: applyConfig,
    verify: showHealth,
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { window.HU.app.boot(); });
} else {
  window.HU.app.boot();
}
