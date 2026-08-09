// ============================================================================
// Hyaku Asura — Damage Lab UI
// Self-contained vanilla JS: stat editor, style table, skill list, compare
// list, balance editing, share codes (base64url JSON in the URL hash),
// plus balance-analysis tools: skill power rank, TTK simulation, stat
// sensitivity, build optimizer, and damage curves.
// ============================================================================
(function () {
  "use strict";

  var DATA = window.HYAKU_DATA;
  var Calc = window.HyakuCalc;

  var DEFAULT_STATS = {
    Strength: 2000, Muscle: 2000, Fat: 300, Agility: 1000,
    AttackSpeed: 1000, Durability: 1000, StaminaInStat: 1000, MaxStamina: 100,
  };
  var DEFAULT_MULTS = { BasicAttackDmg: 1, CriticalDmg: 1, SkillDmg: 1 };
  var DEFAULT_SCN = { HitCount: 1, Attackers: 1, Rhythm: 0 };
  var DEFAULT_ANA = { target: "M1", hp: 100, def: 0, budget: 5000, tab: "dps" };

  var PRESETS = [
    { name: "Balanced", stats: { Strength: 2000, Muscle: 2000, Fat: 300, Agility: 1000, AttackSpeed: 1000, Durability: 1000, StaminaInStat: 1000, MaxStamina: 100 } },
    { name: "Pure Strength", stats: { Strength: 4500, Muscle: 500, Fat: 0, Agility: 500, AttackSpeed: 500, Durability: 500, StaminaInStat: 500, MaxStamina: 100 } },
    { name: "Brawny", stats: { Strength: 3000, Muscle: 3000, Fat: 1000, Agility: 500, AttackSpeed: 500, Durability: 2000, StaminaInStat: 1000, MaxStamina: 100 } },
    { name: "Tank", stats: { Strength: 1000, Muscle: 3000, Fat: 2000, Agility: 500, AttackSpeed: 500, Durability: 4500, StaminaInStat: 2000, MaxStamina: 150 } },
    { name: "Speedster", stats: { Strength: 1000, Muscle: 500, Fat: 0, Agility: 2500, AttackSpeed: 3000, Durability: 500, StaminaInStat: 2000, MaxStamina: 120 } },
  ];

  var SCALING_FIELDS = [
    "StrengthScaling", "UpperMuscleScaling", "LowerMuscleScaling",
    "FatScaling", "AgilityScaling", "AttackSpeedScaling",
  ];
  var SD_FIELDS = { power: "Power", cooldown: "Cooldown", range: "Range", speed: "Speed" };
  var STYLE_EDIT_FIELDS = [
    { label: "Base M1 damage", key: "BaseDamageM1" },
    { label: "Base M2 damage", key: "BaseDamageM2" },
    { label: "Base stun", key: "BaseStun" },
    { label: "M1 speed", key: "M1Speed" },
    { label: "M2 speed", key: "M2Speed" },
    { label: "M1 stamina cost", key: "M1StaminaCost" },
    { label: "M2 stamina cost", key: "M2StaminaCost" },
    { label: "Strength scaling", key: "StrengthScaling" },
    { label: "Upper muscle scaling", key: "UpperMuscleScaling" },
    { label: "Lower muscle scaling", key: "LowerMuscleScaling" },
    { label: "Fat scaling", key: "FatScaling" },
    { label: "Muscle threshold", key: "TMThreshold", optional: true },
  ];
  var ANA_TABS = ["dps", "ttk", "sens", "opt", "curves"];

  var state = {
    stats: Object.assign({}, DEFAULT_STATS),
    mults: Object.assign({}, DEFAULT_MULTS),
    scn: Object.assign({}, DEFAULT_SCN),
    ana: Object.assign({}, DEFAULT_ANA),
    style: "The_Middle",
    edit: false,
    skillFilter: "",
    skillSearch: "",
    overrides: {},       // skill key -> { power?, cooldown?, range?, speed?, scaling? }
    styleOverrides: {},  // style name -> { field: value }
    compare: [],         // ordered skill keys
  };

  var $ = function (id) { return document.getElementById(id); };
  var styleLabel = function (key) { return key.replace(/_/g, " "); };
  var fmt = function (n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // ---------------- merged views ----------------

  function getStyle(name) {
    var live = DATA.styles[name] || {};
    var ov = state.styleOverrides[name] || {};
    var out = Object.assign({}, live);
    Object.keys(ov).forEach(function (k) {
      var v = ov[k];
      if (v !== "" && v != null) out[k] = Number(v);
    });
    return out;
  }

  function getSkill(key) {
    var live = DATA.skills[key] || {};
    var ov = state.overrides[key] || {};
    var out = Object.assign({}, live, { SkillData: Object.assign({}, live.SkillData || {}) });
    Object.keys(SD_FIELDS).forEach(function (f) {
      var v = ov[f];
      if (v !== "" && v != null) out.SkillData[SD_FIELDS[f]] = Number(v);
    });
    return out;
  }

  function getScaling(key, skill) {
    var live = DATA.skillScaling[key];
    var fallback = skill && skill.Style ? DATA.styles[skill.Style] : null;
    var base = live || fallback || null;
    var ov = state.overrides[key] && state.overrides[key].scaling;
    if (!ov) return base;
    var s = {};
    SCALING_FIELDS.forEach(function (f) {
      var v = ov[f];
      s[f] = (v !== "" && v != null) ? Number(v) : (base ? base[f] : 0);
    });
    return s;
  }

  function hasScalingOverride(key) {
    var ov = state.overrides[key];
    return !!(ov && ov.scaling);
  }

  function isListable(key) {
    var s = DATA.skills[key];
    if (!s) return false;
    if (s.IsSkill === false) return false;
    if (s.IgnoreOffensiveCheck) return false;
    return !!(s.SkillData && s.SkillData.Power != null && s.SkillData.Power > 0);
  }

  // ---------------- share codes ----------------

  function toBase64Url(str) {
    var b = btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(str) {
    var b = str.replace(/-/g, "+").replace(/_/g, "/");
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
    };
  }

  function sanitizeAna(ana) {
    var a = Object.assign({}, DEFAULT_ANA, ana || {});
    a.hp = Math.max(0, Number(a.hp) || 100);
    a.def = Math.min(95, Math.max(0, Number(a.def) || 0));
    a.budget = Math.max(0, Number(a.budget) || 0);
    if (a.target !== "M1" && a.target !== "M2" && !DATA.skills[a.target]) a.target = "M1";
    if (ANA_TABS.indexOf(a.tab) === -1) a.tab = "dps";
    return a;
  }

  function applyConfig(cfg) {
    if (!cfg || cfg.v !== 1) throw new Error("Unsupported config version");
    state.stats = Object.assign({}, DEFAULT_STATS, cfg.stats || {});
    state.mults = Object.assign({}, DEFAULT_MULTS, cfg.mults || {});
    state.scn = Object.assign({}, DEFAULT_SCN, cfg.scn || {});
    state.ana = sanitizeAna(cfg.ana);
    state.style = (cfg.style && DATA.styles[cfg.style]) ? cfg.style : "The_Middle";
    state.overrides = sanitizeOverrides(cfg.over || {});
    state.styleOverrides = sanitizeStyleOverrides(cfg.sover || {});
    state.compare = (cfg.list || []).filter(function (k) { return DATA.skills[k]; });
  }

  function sanitizeOverrides(over) {
    var out = {};
    Object.keys(over).forEach(function (k) {
      if (!DATA.skills[k]) return;
      var o = over[k];
      if (!o || typeof o !== "object") return;
      var c = {};
      Object.keys(SD_FIELDS).forEach(function (f) {
        var v = o[f];
        if (v !== "" && v != null && isFinite(Number(v))) c[f] = Number(v);
      });
      if (o.scaling && typeof o.scaling === "object") {
        var s = {};
        SCALING_FIELDS.forEach(function (f) {
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
      STYLE_EDIT_FIELDS.forEach(function (f) {
        var v = o[f.key];
        if (v !== "" && v != null && isFinite(Number(v))) c[f.key] = Number(v);
      });
      if (Object.keys(c).length) out[k] = c;
    });
    return out;
  }

  function shareCode() {
    return toBase64Url(JSON.stringify(buildConfig()));
  }
  function codeFromString(s) { return fromBase64Url(s.trim()); }

  function setHash(code) {
    try { history.replaceState(null, "", "#cfg=" + code); } catch (e) { /* noop */ }
  }
  function readHash() {
    var m = location.hash.match(/^#cfg=(.+)$/);
    return m ? m[1] : null;
  }

  // ---------------- status ----------------

  function status(msg, ok) {
    var el = $("status");
    el.textContent = msg;
    el.className = "status " + (ok === false ? "err" : ok ? "ok" : "");
    clearTimeout(status._t);
    status._t = setTimeout(function () { el.textContent = ""; el.className = "status"; }, 4000);
  }

  // ---------------- init / render ----------------

  function initSelects() {
    var sel = $("styleSelect");
    DATA.styleOrder.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = styleLabel(k);
      sel.appendChild(o);
    });
    sel.value = state.style;

    var flt = $("skillFilter");
    var withSkills = {};
    Object.keys(DATA.skills).forEach(function (k) {
      if (!isListable(k)) return;
      var s = DATA.skills[k].Style;
      if (s && DATA.styles[s]) withSkills[s] = true;
    });
    Object.keys(withSkills).forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = styleLabel(s);
      flt.appendChild(o);
    });

    var at = $("anaTarget");
    [["M1", "M1 attack"], ["M2", "M2 attack"]].forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      at.appendChild(o);
    });
    Object.keys(DATA.skills).filter(isListable).sort(function (a, b) {
      return (DATA.skills[a].DisplayName || a).localeCompare(DATA.skills[b].DisplayName || b);
    }).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = DATA.skills[k].DisplayName || k;
      at.appendChild(o);
    });
    at.value = state.ana.target;
  }

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
        renderAll();
        status("Preset “" + p.name + "” applied.", true);
      });
      bar.appendChild(b);
    });
  }

  function statInputs() {
    Object.keys(DEFAULT_STATS).forEach(function (k) {
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
  }

  function numOr(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function bindStatInputs() {
    Object.keys(DEFAULT_STATS).forEach(function (k) {
      $("stat-" + k).addEventListener("input", function (e) {
        state.stats[k] = numOr(e.target.value, DEFAULT_STATS[k]);
        renderAll();
      });
    });
    ["BasicAttackDmg", "CriticalDmg", "SkillDmg"].forEach(function (k) {
      $("mult-" + k).addEventListener("input", function (e) {
        state.mults[k] = numOr(e.target.value, 1);
        renderAll();
      });
    });
    ["HitCount", "Attackers", "Rhythm"].forEach(function (k) {
      $("scn-" + k).addEventListener("input", function (e) {
        state.scn[k] = numOr(e.target.value, DEFAULT_SCN[k]);
        renderAll();
      });
    });
    $("styleSelect").addEventListener("change", function (e) {
      state.style = e.target.value;
      renderAll();
    });
    bindStyleMatrix();
    $("editBalance").addEventListener("change", function (e) {
      state.edit = e.target.checked;
      renderAll();
    });
    $("skillFilter").addEventListener("change", function (e) {
      state.skillFilter = e.target.value;
      renderSkills();
    });
    $("skillSearch").addEventListener("input", function (e) {
      state.skillSearch = e.target.value.toLowerCase();
      renderSkills();
    });

    // analysis inputs
    $("anaTarget").addEventListener("change", function (e) {
      state.ana.target = e.target.value;
      renderAnalysis();
    });
    $("ana-hp").addEventListener("input", function (e) {
      state.ana.hp = numOr(e.target.value, DEFAULT_ANA.hp);
      renderTTK();
    });
    $("ana-def").addEventListener("input", function (e) {
      state.ana.def = numOr(e.target.value, 0);
      renderTTK();
    });
    $("ana-budget").addEventListener("input", function (e) {
      state.ana.budget = numOr(e.target.value, 0);
      renderOptimizer();
    });
    $("anaTabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      state.ana.tab = btn.dataset.tab;
      renderAnalysis();
    });
  }

  function renderAll() {
    renderStylesMatrix();
    renderStyle();
    renderSkills();
    renderCompare();
    renderScenario();
    renderAnalysis();
  }

  // ---------------- style damage matrix ----------------

  function renderStylesMatrix() {
    var stats = state.stats;
    var def = Calc.TotalDefense(stats);

    var rows = Object.keys(DATA.styles).map(function (key) {
      var style = getStyle(key);
      var m1 = Calc.ComputeM1Damage({ style: style, stats: stats, basicAttackDmg: state.mults.BasicAttackDmg });
      var m2 = Calc.ComputeM2Damage({ style: style, stats: stats, criticalDmg: state.mults.CriticalDmg });
      var ov = state.styleOverrides[key];
      return {
        key: key,
        m1: m1, m2: m2,
        m1p: Calc.MitigatedDamage(m1, stats),
        m2p: Calc.MitigatedDamage(m2, stats),
        s1: Calc.ScaleGetASMultiplier({ style: style, stats: stats, isM2: false }),
        s2: Calc.ScaleGetASMultiplier({ style: style, stats: stats, isM2: true }),
        st1: Calc.GetStamDrain({ style: style, stats: stats, attack: "M1" }),
        st2: Calc.GetStamDrain({ style: style, stats: stats, attack: "M2" }),
        edited: !!(ov && Object.keys(ov).length),
      };
    });

    var html = rows.map(function (r) {
      var sel = r.key === state.style ? ' class="sel"' : "";
      var star = r.edited ? ' <span class="live">*edited</span>' : "";
      return "<tr data-style=\"" + r.key + "\"" + sel + ">" +
        "<td><strong>" + styleLabel(r.key) + "</strong>" + star + "</td>" +
        '<td class="num">' + fmt(r.m1) + "</td>" +
        '<td class="num">' + fmt(r.m1p) + "</td>" +
        '<td class="num">' + fmt(r.m2) + "</td>" +
        '<td class="num">' + fmt(r.m2p) + "</td>" +
        '<td class="num">' + fmt(r.s1) + "</td>" +
        '<td class="num">' + fmt(r.s2) + "</td>" +
        '<td class="num">' + fmt(r.st1) + "</td>" +
        '<td class="num">' + fmt(r.st2) + "</td>" +
        "</tr>";
    }).join("");

    $("styleMatrix").innerHTML =
      "<thead><tr>" +
      "<th>Style</th><th class='num'>M1</th><th class='num'>M1 after def</th>" +
      "<th class='num'>M2</th><th class='num'>M2 after def</th>" +
      "<th class='num'>M1 spd</th><th class='num'>M2 spd</th>" +
      "<th class='num'>M1 stam</th><th class='num'>M2 stam</th>" +
      "</tr></thead><tbody>" + html + "</tbody>";

    var hint = document.getElementById("matrixHint");
    if (hint) {
      hint.textContent = "Every style computed from your current stats + balance edits. Defense only depends on your build (" +
        fmt(def * 100) + "% total, applied in the “after def” columns). Click a row to select it for balance editing; “*edited” marks styles with overrides.";
    }
  }

  function bindStyleMatrix() {
    $("styleMatrix").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-style]");
      if (!tr) return;
      if (state.style === tr.dataset.style) return;
      state.style = tr.dataset.style;
      $("styleSelect").value = state.style;
      renderAll();
    });
  }

  // ---------------- style section ----------------

  function renderStyle() {
    var style = getStyle(state.style);
    var stats = state.stats;

    var m1 = Calc.ComputeM1Damage({ style: style, stats: stats, basicAttackDmg: state.mults.BasicAttackDmg });
    var m2 = Calc.ComputeM2Damage({ style: style, stats: stats, criticalDmg: state.mults.CriticalDmg });
    var def = Calc.TotalDefense(stats);

    var hero = {
      "heroM1": fmt(m1),
      "heroM2": fmt(m2),
      "heroDef": fmt(def * 100),
      "heroStyle": styleLabel(state.style),
    };
    Object.keys(hero).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = hero[id];
    });

    var ro = [
      { k: "M1 damage", v: fmt(m1), cls: "big" },
      { k: "M2 damage", v: fmt(m2), cls: "big" },
      { k: "M1 after defense", v: fmt(Calc.MitigatedDamage(m1, stats)) },
      { k: "M2 after defense", v: fmt(Calc.MitigatedDamage(m2, stats)) },
      { k: "M1 swing speed", v: fmt(Calc.ScaleGetASMultiplier({ style: style, stats: stats, isM2: false })) },
      { k: "M2 swing speed", v: fmt(Calc.ScaleGetASMultiplier({ style: style, stats: stats, isM2: true })) },
      { k: "M1 stam drain", v: fmt(Calc.GetStamDrain({ style: style, stats: stats, attack: "M1" })) },
      { k: "M2 stam drain", v: fmt(Calc.GetStamDrain({ style: style, stats: stats, attack: "M2" })) },
      { k: "Dura defense", v: fmt(Calc.GetDurabilityDefense(stats)) + "%" },
      { k: "Muscle defense", v: fmt(Calc.GetMuscleDefense(stats)) + "%" },
      { k: "Fat defense", v: fmt(Calc.GetFatDefense(stats)) + "%" },
      { k: "Total defense", v: fmt(def * 100) + "%" },
      { k: "AS stun mult", v: fmt(Calc.GetAttackSpeedStunMultiplier(stats)) },
      { k: "Hit-count decay", v: fmt(Calc.GetHitCountDamageDecay(state.scn.HitCount)) },
      { k: "Multi-attacker stun", v: fmt(Calc.GetMultiAttackerStunMultiplier(state.scn.Attackers)) },
      { k: "Rhythm stam mul", v: fmt(Calc.GetRhythmStamMul(state.scn.Rhythm)) },
    ];
    var roEl = document.getElementById("styleReadouts");
    if (roEl) {
      roEl.innerHTML = ro.map(function (r) {
        return '<div class="ro"><div class="k">' + r.k + '</div><div class="v ' + (r.cls || "") + '">' + r.v + "</div></div>";
      }).join("");
    }

    var ov = state.styleOverrides[state.style] || {};
    var rows = STYLE_EDIT_FIELDS.filter(function (f) {
      return !f.optional || style[f.key] != null;
    }).map(function (f) {
      var live = DATA.styles[state.style][f.key];
      var val = ov[f.key] !== undefined ? ov[f.key] : "";
      var input = '<input type="number" step="0.01" data-stylefield="' + f.key + '" value="' + val + '" ' +
        (state.edit ? "" : "disabled") + ' />' +
        '<span class="live">live: ' + (live != null ? live : "—") + "</span>";
      return '<tr><td>' + f.label + '</td><td class="num">' + input + "</td></tr>";
    }).join("");
    $("styleTable").innerHTML =
      "<thead><tr><th>Property</th><th class='num'>Value</th></tr></thead><tbody>" + rows + "</tbody>";
  }

  function bindStyleTable() {
    $("styleTable").addEventListener("input", function (e) {
      var input = e.target;
      if (input.tagName !== "INPUT" || !input.dataset.stylefield) return;
      var key = input.dataset.stylefield;
      var ov = state.styleOverrides[state.style] || (state.styleOverrides[state.style] = {});
      var v = input.value;
      if (v === "") delete ov[key];
      else ov[key] = numOr(v, 0);
      if (!Object.keys(ov).length) delete state.styleOverrides[state.style];
      renderStylesMatrix();
      renderStyle();
      renderCompare();
      renderAnalysis();
    });
  }

  // ---------------- skills table ----------------

  function renderSkills() {
    var keys = Object.keys(DATA.skills).filter(isListable).filter(function (k) {
      var s = DATA.skills[k];
      if (state.skillFilter && s.Style !== state.skillFilter) return false;
      if (state.skillSearch && s.DisplayName.toLowerCase().indexOf(state.skillSearch) === -1) return false;
      return true;
    });
    keys.sort(function (a, b) {
      return (DATA.skills[a].DisplayName || a).localeCompare(DATA.skills[b].DisplayName || b);
    });
    $("skillCount").textContent = keys.length + " skill" + (keys.length === 1 ? "" : "s");

    var rows = keys.map(function (k) {
      var s = getSkill(k);
      var sd = s.SkillData;
      var scaling = getScaling(k, s);
      var dmg = Calc.ComputeSkillDamage({
        skill: s, scaling: scaling, stats: state.stats, skillDmg: state.mults.SkillDmg,
      });
      var tags = "";
      if (s.HyperArmour) tags += '<span class="tag hp">HA</span>';
      if (s.GrabSkill) tags += '<span class="tag grab">grab</span>';
      if (s.CounterSkill) tags += '<span class="tag counter">counter</span>';
      if (s.IFrame) tags += '<span class="tag ifr">iframe</span>';
      var added = state.compare.indexOf(k) !== -1;
      return "<tr>" +
        "<td>" + (s.DisplayName || k) + tags + "</td>" +
        "<td>" + (s.Style ? styleLabel(s.Style) : "—") + "</td>" +
        '<td class="num">' + sd.Cooldown + "</td>" +
        '<td class="num">' + sd.Range + "</td>" +
        '<td class="num">' + sd.Speed + "</td>" +
        '<td class="num">' + fmt(sd.Power) + "</td>" +
        '<td class="num"><strong>' + fmt(dmg) + "</strong></td>" +
        '<td class="num">' +
        (added
          ? '<span class="tag hp">added</span>'
          : '<button class="btn" data-add="' + k + '">Compare</button>') +
        "</td>" +
        "</tr>";
    }).join("");

    $("skillsTable").innerHTML =
      "<thead><tr>" +
      "<th>Skill</th><th>Style</th><th class='num'>CD</th><th class='num'>Range</th>" +
      "<th class='num'>Spd</th><th class='num'>Power</th><th class='num'>Damage</th><th></th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="8" class="hint">No skills match.</td></tr>') + "</tbody>";
  }

  function bindSkillsTable() {
    $("skillsTable").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-add]");
      if (!btn) return;
      var k = btn.dataset.add;
      if (state.compare.indexOf(k) === -1) state.compare.push(k);
      renderSkills();
      renderCompare();
    });
  }

  // ---------------- compare list ----------------

  function renderCompare() {
    var list = $("compareList");
    $("compareCount").textContent = state.compare.length + " item" + (state.compare.length === 1 ? "" : "s");
    $("compareEmpty").style.display = state.compare.length ? "none" : "block";
    list.innerHTML = "";

    state.compare.forEach(function (k) {
      var s = getSkill(k);
      var sd = s.SkillData;
      var scaling = getScaling(k, s);
      var dmg = Calc.ComputeSkillDamage({
        skill: s, scaling: scaling, stats: state.stats, skillDmg: state.mults.SkillDmg,
      });
      var decay = Calc.GetHitCountDamageDecay(state.scn.HitCount);
      var atkStun = Calc.GetMultiAttackerStunMultiplier(state.scn.Attackers);
      var scnDmg = dmg * decay * atkStun;

      var ov = state.overrides[k] || {};

      var editInputs = Object.keys(SD_FIELDS).map(function (f) {
        var val = ov[f] !== undefined ? ov[f] : "";
        return '<label>' + SD_FIELDS[f] +
          '<input type="number" step="0.01" data-ovfield="' + f + '" data-skill="' + k + '" value="' + val + '" ' +
          (state.edit ? "" : "disabled") + ' />' +
          '<span class="live">live: ' + sd[SD_FIELDS[f]] + "</span></label>";
      }).join("");

      var scalingBox = "";
      if (DATA.skillScaling[k] || s.Style) {
        var base = DATA.skillScaling[k] || DATA.styles[s.Style] || {};
        var sov = (hasScalingOverride(k) && ov.scaling) || {};
        var scFields = SCALING_FIELDS.map(function (f) {
          var val = sov[f] !== undefined ? sov[f] : "";
          var live = base[f] != null ? base[f] : 0;
          return '<label>' + f.replace("Scaling", "") +
            '<input type="number" step="0.01" data-scalingfield="' + f + '" data-skill="' + k + '" value="' + val + '" ' +
            (state.edit ? "" : "disabled") + ' />' +
            '<span class="live">' + (DATA.skillScaling[k] ? "live: " : "style: ") + live + "</span></label>";
        }).join("");
        scalingBox =
          "<details class='scaling-box'><summary>Scaling" + (hasScalingOverride(k) ? " (custom)" : "") + "</summary>" +
          "<div class='compare-grid'>" + scFields + "</div></details>";
      }

      var item = document.createElement("div");
      item.className = "compare-item";
      item.innerHTML =
        '<div class="compare-head">' +
        '<span class="name">' + (s.DisplayName || k) + ' <span class="tag">' + styleLabel(s.Style || "?") + "</span></span>" +
        '<span class="dmg">' + fmt(dmg) +
        " <span class='live'>scenario " + fmt(scnDmg) + " · after def " + fmt(Calc.MitigatedDamage(scnDmg, state.stats)) + "</span></span>" +
        '<button class="btn ghost" data-remove="' + k + '">Remove</button>' +
        "</div>" +
        "<div class='compare-grid'>" + editInputs + "</div>" +
        scalingBox;
      list.appendChild(item);
    });
  }

  function bindCompare() {
    $("compareList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-remove]");
      if (!btn) return;
      var k = btn.dataset.remove;
      state.compare = state.compare.filter(function (x) { return x !== k; });
      renderSkills();
      renderCompare();
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
      renderCompare();
      renderSkills();
      renderAnalysis();
    });
  }

  // ---------------- scenario readouts ----------------

  function renderScenario() {
    var decay = Calc.GetHitCountDamageDecay(state.scn.HitCount);
    var atkStun = Calc.GetMultiAttackerStunMultiplier(state.scn.Attackers);
    var rhythm = Calc.GetRhythmStamMul(state.scn.Rhythm);
    $("scenarioReadouts").innerHTML = [
      { k: "Hit-count damage decay", v: "× " + fmt(decay) },
      { k: "Multi-attacker stun", v: "× " + fmt(atkStun) },
      { k: "Rhythm stamina multiplier", v: "× " + fmt(rhythm) },
    ].map(function (r) {
      return '<div class="ro"><div class="k">' + r.k + '</div><div class="v small">' + r.v + "</div></div>";
    }).join("");
  }

  // ---------------- analysis ----------------

  function anaDamage(target, st, mults) {
    st = st || state.stats;
    mults = mults || state.mults;
    if (target === "M1") return Calc.ComputeM1Damage({ style: getStyle(state.style), stats: st, basicAttackDmg: mults.BasicAttackDmg });
    if (target === "M2") return Calc.ComputeM2Damage({ style: getStyle(state.style), stats: st, criticalDmg: mults.CriticalDmg });
    if (!DATA.skills[target]) return 0;
    var s = getSkill(target);
    return Calc.ComputeSkillDamage({ skill: s, scaling: getScaling(target, s), stats: st, skillDmg: mults.SkillDmg });
  }

  function renderAnalysis() {
    var t = state.ana.tab;
    ANA_TABS.forEach(function (k) {
      $("ana-" + k).hidden = (k !== t);
    });
    document.querySelectorAll("#anaTabs .tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === t);
    });
    if (t === "dps") renderDps();
    else if (t === "ttk") renderTTK();
    else if (t === "sens") renderSensitivity();
    else if (t === "opt") renderOptimizer();
    else renderCurves();
  }

  function renderDps() {
    var rows = [];
    Object.keys(DATA.skills).filter(isListable).forEach(function (k) {
      var s = getSkill(k);
      var sd = s.SkillData;
      var cd = typeof sd.Cooldown === "number" ? sd.Cooldown : 0;
      if (cd <= 0) return;
      var dmg = Calc.ComputeSkillDamage({ skill: s, scaling: getScaling(k, s), stats: state.stats, skillDmg: state.mults.SkillDmg });
      var cycle = Math.max(cd, 1);
      rows.push({ k: k, name: s.DisplayName || k, style: s.Style, cd: cd, range: sd.Range, speed: sd.Speed, dmg: dmg, dps: dmg / cycle });
    });
    rows.sort(function (a, b) { return b.dps - a.dps; });
    var median = rows.length ? rows[Math.floor(rows.length / 2)].dps : 0;

    var html = rows.map(function (r, i) {
      var rel = median > 0 ? r.dps / median : 1;
      var bandV = rel >= 1.5 ? "band high" : rel <= 0.6 ? "band low" : "";
      var relTxt = median > 0 ? ((rel - 1) * 100).toFixed(0) + "%" : "—";
      if (median > 0 && rel > 1) relTxt = "+" + relTxt;
      return "<tr>" +
        '<td class="num">' + (i + 1) + "</td>" +
        "<td>" + r.name + "</td>" +
        "<td>" + (r.style ? styleLabel(r.style) : "—") + "</td>" +
        '<td class="num">' + r.cd + '</td><td class="num">' + fmt(r.range) + '</td><td class="num">' + fmt(r.speed) + "</td>" +
        '<td class="num">' + fmt(r.dmg) + "</td>" +
        '<td class="num ' + bandV + '"><strong>' + fmt(r.dps) + "</strong></td>" +
        '<td class="num ' + bandV + '">' + relTxt + "</td>" +
        "</tr>";
    }).join("");

    $("dpsTable").innerHTML =
      "<thead><tr>" +
      "<th class='num'>#</th><th>Skill</th><th>Style</th><th class='num'>CD</th>" +
      "<th class='num'>Range</th><th class='num'>Spd</th><th class='num'>Damage</th>" +
      "<th class='num'>DPS</th><th class='num'>vs median</th>" +
      "</tr></thead><tbody>" + html + "</tbody>";
  }

  function renderTTK() {
    var hp = Math.max(1, state.ana.hp);
    var def = Math.min(0.95, Math.max(0, state.ana.def / 100));
    var ehp = hp / (1 - def);

    function decayFor(hits) { return Calc.GetHitCountDamageDecay(hits); }

    function simM1() {
      var style = getStyle(state.style);
      var speed = Math.max(Calc.ScaleGetASMultiplier({ style: style, stats: state.stats, isM2: false }), 0.1);
      var perHit = Calc.ComputeM1Damage({ style: style, stats: state.stats, basicAttackDmg: state.mults.BasicAttackDmg });
      var t = 0, hits = 0, sum = 0;
      while (sum < ehp && t < 900 && hits < 200000) {
        hits++;
        sum += perHit * decayFor(hits);
        t += 1 / speed;
      }
      return { ttk: t, hits: hits, sum: sum };
    }

    var names = [], damages = [], cds = [], casts = [];
    state.compare.forEach(function (k) {
      var s = getSkill(k);
      var sd = s.SkillData;
      names.push(s.DisplayName || k);
      damages.push(Calc.ComputeSkillDamage({ skill: s, scaling: getScaling(k, s), stats: state.stats, skillDmg: state.mults.SkillDmg }));
      cds.push(typeof sd.Cooldown === "number" && sd.Cooldown > 0 ? sd.Cooldown : 0.5);
      casts.push(Math.min(Math.max(1 / Math.max(sd.Speed || 1, 0.1), 0.05), 2.5));
    });

    function simRotation() {
      var t = 0, hits = 0, sum = 0;
      var ready = cds.map(function () { return 0; });
      var guard = 0;
      while (sum < ehp && t < 900 && guard++ < 500000) {
        var cast = -1, nextT = Infinity;
        for (var i = 0; i < cds.length; i++) {
          if (ready[i] <= t + 1e-9) { cast = i; break; }
          if (ready[i] < nextT) nextT = ready[i];
        }
        if (cast === -1) {
          if (nextT === Infinity) break;
          t = nextT;
          continue;
        }
        hits++;
        sum += damages[cast] * decayFor(hits);
        ready[cast] = t + Math.max(cds[cast], 0.1) + casts[cast];
        t += casts[cast];
      }
      return { ttk: t, hits: hits, sum: sum };
    }

    var rot = names.length ? simRotation() : null;
    var m1 = simM1();

    var ro = [
      { k: "Target HP", v: fmt(hp) },
      { k: "Effective HP", v: fmt(ehp) + " (" + fmt(def * 100) + "% def)" },
      { k: "Rotation TTK", v: rot ? fmt(rot.ttk) + "s" : "—", cls: rot ? "" : "small" },
      { k: "Rotation hits", v: rot ? rot.hits : "—" },
      { k: "Rotation DPS", v: rot && rot.ttk > 0 ? fmt(ehp / rot.ttk) : "—" },
      { k: "M1-spam TTK", v: fmt(m1.ttk) + "s" },
      { k: "M1-spam hits", v: m1.hits },
      { k: "Overkill (rotation)", v: rot ? fmt(((rot.sum - ehp) / ehp) * 100) + "%" : "—" },
    ];
    $("ttkReadouts").innerHTML = ro.map(function (r) {
      return '<div class="ro"><div class="k">' + r.k + '</div><div class="v ' + (r.cls || "") + '">' + r.v + "</div></div>";
    }).join("");

    var detail = "";
    if (names.length) {
      detail = '<table class="table ttk-skills"><thead><tr><th>Rotation</th><th class="num">CD</th>' +
        '<th class="num">Cast (est)</th><th class="num">Damage</th></tr></thead><tbody>' +
        names.map(function (n, i) {
          return "<tr><td>" + n + '</td><td class="num">' + cds[i] + '</td><td class="num">' + fmt(casts[i]) +
            '</td><td class="num">' + fmt(damages[i]) + "</td></tr>";
        }).join("") + "</tbody></table>";
    } else {
      detail = '<p class="hint">Add skills to the compare list to build a rotation; right now it is pure M1 spam.</p>';
    }
    $("ttkDetail").innerHTML = detail;
  }

  function renderSensitivity() {
    var target = state.ana.target;
    var base = anaDamage(target);
    var style = getStyle(state.style);

    function bump(stat, amount) {
      var st = Object.assign({}, state.stats);
      st[stat] = Math.max(0, st[stat] + amount);
      return st;
    }
    function row(label, dmg2, delta, note, extra) {
      var d = (typeof dmg2 === "number") ? dmg2 - base : null;
      var pct = (typeof dmg2 === "number" && base > 0) ? (d / base) * 100 : null;
      return "<tr><td>" + label + "</td>" +
        '<td class="num">' + (typeof base === "number" ? fmt(base) : "—") + "</td>" +
        '<td class="num">' + (typeof dmg2 === "number" ? fmt(dmg2) : "—") + "</td>" +
        '<td class="num">' + (d !== null ? (d > 0 ? "+" : "") + fmt(d) : "—") + "</td>" +
        '<td class="num">' + (pct !== null ? (pct > 0 ? "+" : "") + fmt(pct) + "%" : "—") + "</td>" +
        "<td>" + (note || "") + (extra || "") + "</td></tr>";
    }

    var r = "<thead><tr><th>Stat</th><th class='num'>Base dmg</th><th class='num'>+100 →</th>" +
      "<th class='num'>Δ dmg</th><th class='num'>Δ %</th><th>Effect</th></tr></thead><tbody>";

    r += row("Strength", anaDamage(target, bump("Strength", 100)), null, "damage feed");
    r += row("Muscle", anaDamage(target, bump("Muscle", 100)), null, "damage feed");
    r += row("Fat", anaDamage(target, bump("Fat", 100)), null, "damage feed");

    var swing0 = Calc.ScaleGetASMultiplier({ style: style, stats: state.stats, isM2: false });
    var swing1 = Calc.ScaleGetASMultiplier({ style: style, stats: bump("AttackSpeed", 100), isM2: false });
    r += row("Agility", null, null, "no hit damage effect (run-stamina only)");
    r += row("Attack Speed", null, null,
      "no hit damage effect · M1 swing " + fmt(swing0) + " → " + fmt(swing1));

    var def0 = Calc.GetDurabilityDefense(state.stats) * 100;
    var def1 = Calc.GetDurabilityDefense(bump("Durability", 100)) * 100;
    r += row("Durability", null, null,
      "defense " + fmt(def0) + "% → " + fmt(def1) + "% (no damage increase)");

    r += "</tbody>";
    $("sensTable").innerHTML = r;
  }

  function renderOptimizer() {
    var budget = Math.max(0, Math.floor(state.ana.budget / 250) * 250);
    var target = state.ana.target;
    var results = [];
    for (var S = 0; S <= budget; S += 250) {
      for (var M = 0; M <= budget - S; M += 250) {
        var F = budget - S - M;
        var st = Object.assign({}, state.stats, { Strength: S, Muscle: M, Fat: F });
        results.push({ S: S, M: M, F: F, dmg: anaDamage(target, st) });
      }
    }
    results.sort(function (a, b) { return b.dmg - a.dmg; });
    var top = results.slice(0, 6);

    var current = anaDamage(target);
    var totalNow = state.stats.Strength + state.stats.Muscle + state.stats.Fat;

    var html = '<div class="hint">Budget ' + fmt(budget) + " · current " +
      fmt(totalNow) + " (" + (totalNow === budget ? "matches budget" : "≠ budget — reallocated to exactly " + fmt(budget) + ")") +
      " · current build deals <strong>" + fmt(current) + "</strong> for “" + (target === "M1" ? "M1" : target === "M2" ? "M2" : (DATA.skills[target] ? DATA.skills[target].DisplayName : target)) + "”.</div>";

    html += '<div class="opt-grid m12">' + top.map(function (o, i) {
      return '<div class="opt-card' + (i === 0 ? " best" : "") + '">' +
        '<div class="o-dmg">' + fmt(o.dmg) + "</div>" +
        '<div class="o-row">STR ' + fmt(o.S) + " · MUS " + fmt(o.M) + " · FAT " + fmt(o.F) + "</div>" +
        (i === 0 ? '<div class="live">best allocation</div>' : "") +
        "</div>";
    }).join("") + "</div>";

    $("optResults").innerHTML = html;
  }

  function renderCurves() {
    var target = state.ana.target;
    var base = state.stats;

    function seriesOver(stat, lo, hi, step, compute) {
      var pts = [];
      for (var v = lo; v <= hi; v += step) {
        var st = Object.assign({}, base);
        st[stat] = v;
        pts.push({ x: v, y: compute(st) });
      }
      return pts;
    }

    function skillName() {
      return target === "M1" ? "M1" : target === "M2" ? "M2" : (DATA.skills[target] ? DATA.skills[target].DisplayName : target);
    }
    function fig(title, series, xMax, xLabel) {
      return makeChart(title, series, xMax, xLabel);
    }

    var dmg = function (st) { return anaDamage(target, st); };
    var swing = function (st) { return Calc.ScaleGetASMultiplier({ style: getStyle(state.style), stats: st, isM2: false }); };

    var charts = [];
    charts.push(fig(skillName() + " damage vs Strength", [
      { label: skillName(), color: "#34d399", pts: seriesOver("Strength", 0, 6000, 250, dmg) },
    ], 6000, "Strength"));
    charts.push(fig(skillName() + " damage vs Muscle", [
      { label: skillName(), color: "#34d399", pts: seriesOver("Muscle", 0, 6000, 250, dmg) },
    ], 6000, "Muscle"));
    charts.push(fig(skillName() + " damage vs Fat", [
      { label: skillName(), color: "#34d399", pts: seriesOver("Fat", 0, 6000, 250, dmg) },
    ], 6000, "Fat"));
    charts.push(fig("M1 swing speed vs Attack Speed", [
      { label: "swing", color: "#f4b740", pts: seriesOver("AttackSpeed", 0, 6500, 250, swing) },
    ], 6500, "Attack Speed"));

    $("curveCharts").innerHTML = charts.join("");
  }

  function makeChart(title, series, xMax, xLabel) {
    var W = 360, H = 190, P = 40;
    var plotW = W - P - 10, plotH = H - P - 16;
    var maxY = 1;
    series.forEach(function (s) {
      s.pts.forEach(function (p) { if (p.y > maxY) maxY = p.y; });
    });
    maxY = Math.ceil(maxY * 1.1);

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" role="img" aria-label="' + title + '">';
    for (var g = 0; g <= 4; g++) {
      var yy = P + plotH - (g / 4) * plotH;
      svg += '<line x1="' + P + '" y1="' + yy + '" x2="' + (P + plotW) + '" y2="' + yy + '" class="grid"></line>';
      svg += '<text x="' + (P - 5) + '" y="' + (yy + 3) + '" class="axis" text-anchor="end">' + Math.round(maxY * g / 4) + "</text>";
    }
    svg += '<text x="' + (P + plotW) + '" y="' + (H - 3) + '" class="axis" text-anchor="end">' + xLabel + " " + xMax + "</text>";
    series.forEach(function (s) {
      var pts = s.pts.map(function (p) {
        var x = P + (p.x / xMax) * plotW;
        var y = P + plotH - (p.y / maxY) * plotH;
        return x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      svg += '<polyline points="' + pts + '" class="line" style="stroke:' + s.color + '"></polyline>';
    });
    svg += "</svg>";
    return '<figure class="chart-fig"><figcaption>' + title + "</figcaption>" + svg + "</figure>";
  }

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

    $("btnShare").addEventListener("click", function () {
      var code = shareCode();
      setHash(code);
      copyText(location.href).then(function () {
        status("Share link copied to clipboard.");
      }, function () {
        status("Link ready — copy it from the address bar.", false);
      });
    });

    var heroShare = document.getElementById("btnShareHero");
    if (heroShare) {
      heroShare.addEventListener("click", function () {
        var code = shareCode();
        setHash(code);
        copyText(location.href).then(function () {
          status("Share link copied to clipboard.");
        }, function () {
          status("Link ready — copy it from the address bar.", false);
        });
      });
    }

    $("btnCopy").addEventListener("click", function () {
      var code = shareCode();
      setHash(code);
      $("shareText").value = code;
      copyText(code).then(function () {
        status("Config code copied.");
      }, function () {
        status("Code is in the box above — copy manually.", false);
      });
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
      state.stats = Object.assign({}, DEFAULT_STATS);
      state.mults = Object.assign({}, DEFAULT_MULTS);
      state.scn = Object.assign({}, DEFAULT_SCN);
      state.ana = Object.assign({}, DEFAULT_ANA);
      state.style = "The_Middle";
      state.overrides = {};
      state.styleOverrides = {};
      state.compare = [];
      state.edit = false;
      $("editBalance").checked = false;
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* noop */ }
      syncFromState();
      status("Reset to live game values.", true);
    });
  }

  function syncFromState() {
    $("styleSelect").value = state.style;
    statInputs();
    renderAll();
  }

  // ---------------- boot ----------------

  function boot() {
    var code = readHash();
    if (code) {
      try {
        applyConfig(JSON.parse(codeFromString(code)));
      } catch (e) {
        console.warn("Bad config in URL:", e);
      }
    }
    initSelects();
    statInputs();
    renderPresets();
    bindStatInputs();
    bindStyleTable();
    bindSkillsTable();
    bindCompare();
    bindShare();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
