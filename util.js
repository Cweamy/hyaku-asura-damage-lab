// ============================================================================
// Hyaku Asura — Damage Lab · shared utilities & app state
// `window.HU` is a namespaced module of helpers, the single mutable `state`
// object, data-verification, and a damage cache. No DOM work happens here, so
// the pure logic can be exercised in Node (`node --check` + smoke tests).
// ============================================================================
window.HU = (function () {
  "use strict";

  var DATA = window.HYAKU_DATA;
  var Calc = window.HyakuCalc;

  // ---------------- defaults ----------------

  var DEFAULT_STATS = {
    Strength: 2000, Muscle: 2000, Fat: 300, Agility: 1000,
    AttackSpeed: 1000, Durability: 1000, StaminaInStat: 1000, MaxStamina: 100,
  };
  var DEFAULT_MULTS = { BasicAttackDmg: 1, CriticalDmg: 1, SkillDmg: 1 };
  var DEFAULT_SCN = { HitCount: 1, Attackers: 1, Rhythm: 0 };
  var DEFAULT_ANA = { target: "M1", hp: 100, def: 0, budget: 5000, tab: "dps" };

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

  // ---------------- state (single source of truth) ----------------

  var state = {
    stats: Object.assign({}, DEFAULT_STATS),
    mults: Object.assign({}, DEFAULT_MULTS),
    scn: Object.assign({}, DEFAULT_SCN),
    ana: Object.assign({}, DEFAULT_ANA),
    style: "The_Middle",
    edit: false,
    skillFilter: "",
    skillSearch: "",
    overrides: {},       // skill key -> { power?, cooldown?, range?, speed?, hits?, scaling? }
    styleOverrides: {},  // style name -> { field: value }
    compare: [],         // ordered skill keys
    balSkill: "",        // currently focused skill in the Balance Lab
  };

  // ---------------- tiny helpers ----------------

  // Escape for safe interpolation into HTML text, attributes, and URLs.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmt(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function numOr(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function styleLabel(key) { return key.replace(/_/g, " "); }

  // ---------------- merged views (live data + overrides) ----------------

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

  function stageOf(key) {
    return (DATA.stageData && DATA.stageData[key]) || { hits: 1, sum: 1 };
  }

  // Hit count used for the hit-count-damage-decay simulation. An override here
  // only affects how many times a skill hits for the decay curve — it does NOT
  // change the authoritative total (see effRatio).
  function effHits(key) {
    var ov = state.overrides[key];
    if (ov && ov.hits != null) return Math.max(1, Math.round(Number(ov.hits)));
    return stageOf(key).hits;
  }

  // Total-damage multiplier = Σ live DamageRatio. This is the game-authoritative
  // "how many hits × ratio" total and is independent of any hits override, which
  // keeps the two concepts from silently conflicting.
  function effRatio(key) {
    return stageOf(key).sum;
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

  function listableSkills() {
    return Object.keys(DATA.skills).filter(isListable);
  }

  function skillDisplay(key) {
    var s = DATA.skills[key];
    return (s && s.DisplayName) || key;
  }

  // ---------------- data verification ----------------

  function verifyData() {
    var warnings = [];
    if (!DATA) return ["HYAKU_DATA missing"];
    if (!DATA.DATA_VERSION) warnings.push("data has no DATA_VERSION (re-exported? stale?)");
    var styles = new Set(Object.keys(DATA.styles || {}));
    Object.keys(DATA.skills || {}).forEach(function (k) {
      var s = DATA.skills[k];
      if (s && s.Style && !styles.has(s.Style)) {
        warnings.push("skill '" + k + "' references missing style '" + s.Style + "'");
      }
    });
    (DATA.styleOrder || []).forEach(function (s) {
      if (!styles.has(s)) warnings.push("styleOrder references missing style '" + s + "'");
    });
    Object.keys(DATA.skillScaling || {}).forEach(function (k) {
      if (!(DATA.skills || {})[k]) warnings.push("skillScaling '" + k + "' has no matching skill");
    });
    var listable = listableSkills();
    var noStage = listable.filter(function (k) { return !(DATA.stageData && DATA.stageData[k]); });
    if (noStage.length) {
      warnings.push(noStage.length + " listable skills missing stageData (defaulted hits:1/sum:1): " +
        noStage.slice(0, 8).map(skillDisplay).join(", ") + (noStage.length > 8 ? " …" : ""));
    }
    return warnings;
  }

  // ---------------- damage cache ----------------
  // Damage depends only on (stats, mults, style, overrides). When that signature
  // is unchanged we reuse prior results instead of recomputing ~90 skills on every
  // keystroke. Modified-stat analysis (sensitivity/optimizer/curves) calls the
  // Calc directly and never touches this cache.

  function cacheSig() {
    var st = state.stats, m = state.mults;
    return [
      st.Strength, st.Muscle, st.Fat, st.Agility, st.AttackSpeed, st.Durability, st.StaminaInStat, st.MaxStamina,
      m.BasicAttackDmg, m.CriticalDmg, m.SkillDmg,
      JSON.stringify(state.overrides), JSON.stringify(state.styleOverrides), state.style,
    ].join("|");
  }

  var _sig = null, _cache = {};
  function cacheReset() {
    var s = cacheSig();
    if (s !== _sig) { _sig = s; _cache = {}; }
    return _cache;
  }

  function skillDamage(key) {
    var c = cacheReset();
    if (c["sd:" + key] !== undefined) return c["sd:" + key];
    var s = getSkill(key);
    return (c["sd:" + key] = Calc.ComputeSkillDamage({
      skill: s, scaling: getScaling(key, s), stats: state.stats, skillDmg: state.mults.SkillDmg,
    }));
  }

  function m1Damage(style) {
    var c = cacheReset();
    if (c["m1:" + style] !== undefined) return c["m1:" + style];
    return (c["m1:" + style] = Calc.ComputeM1Damage({
      style: getStyle(style), stats: state.stats, basicAttackDmg: state.mults.BasicAttackDmg,
    }));
  }

  function m2Damage(style) {
    var c = cacheReset();
    if (c["m2:" + style] !== undefined) return c["m2:" + style];
    return (c["m2:" + style] = Calc.ComputeM2Damage({
      style: getStyle(style), stats: state.stats, criticalDmg: state.mults.CriticalDmg,
    }));
  }

  // ---------------- exports ----------------

  return {
    DATA: DATA, Calc: Calc,
    DEFAULT_STATS: DEFAULT_STATS, DEFAULT_MULTS: DEFAULT_MULTS, DEFAULT_SCN: DEFAULT_SCN, DEFAULT_ANA: DEFAULT_ANA,
    SCALING_FIELDS: SCALING_FIELDS, SD_FIELDS: SD_FIELDS, STYLE_EDIT_FIELDS: STYLE_EDIT_FIELDS, ANA_TABS: ANA_TABS,
    state: state,
    esc: esc, fmt: fmt, numOr: numOr, styleLabel: styleLabel,
    getStyle: getStyle, getSkill: getSkill, stageOf: stageOf,
    effHits: effHits, effRatio: effRatio,
    getScaling: getScaling, hasScalingOverride: hasScalingOverride, isListable: isListable,
    listableSkills: listableSkills, skillDisplay: skillDisplay,
    verifyData: verifyData, cacheSig: cacheSig, cacheReset: cacheReset,
    skillDamage: skillDamage, m1Damage: m1Damage, m2Damage: m2Damage,
  };
})();
