// ============================================================================
// Hyaku Asura — Damage Lab · rendering
// `window.HU.render` holds every function that writes to the DOM. It only
// reads `HU.state` / `HU.DATA` / `HU.Calc` and uses `HU.esc()` for any value
// interpolated into HTML. Event wiring and boot live in app.js.
// ============================================================================
window.HU.render = (function () {
  "use strict";

  var HU = window.HU;
  var DATA = HU.DATA, Calc = HU.Calc, state = HU.state;
  var esc = HU.esc, fmt = HU.fmt, numOr = HU.numOr, styleLabel = HU.styleLabel;
  var SD_FIELDS = HU.SD_FIELDS, SCALING_FIELDS = HU.SCALING_FIELDS, STYLE_EDIT_FIELDS = HU.STYLE_EDIT_FIELDS;
  var effHits = HU.effHits, effRatio = HU.effRatio;
  var $ = function (id) { return document.getElementById(id); };

  function renderAll() {
    renderStylesMatrix();
    renderStyle();
    renderSkills();
    renderCompare();
    renderScenario();
    renderBalance();
    renderAnalysis();
  }

  // ---------------- style damage matrix ----------------

  function renderStylesMatrix() {
    var stats = state.stats;
    var def = Calc.TotalDefense(stats);

    var rows = Object.keys(DATA.styles).map(function (key) {
      var m1 = HU.m1Damage(key);
      var m2 = HU.m2Damage(key);
      var style = HU.getStyle(key);
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
      return "<tr data-style=\"" + esc(r.key) + "\"" + sel + ">" +
        "<td><strong>" + esc(styleLabel(r.key)) + "</strong>" + star + "</td>" +
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

    var hint = $("matrixHint");
    if (hint) {
      hint.textContent = "Every style computed from your current stats + balance edits. Defense only depends on your build (" +
        fmt(def * 100) + "% total, applied in the “after def” columns). Click a row to select it for balance editing; “*edited” marks styles with overrides.";
    }
  }

  // ---------------- selected style ----------------

  function renderStyle() {
    var style = HU.getStyle(state.style);
    var stats = state.stats;

    var m1 = HU.m1Damage(state.style);
    var m2 = HU.m2Damage(state.style);
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
    var roEl = $("styleReadouts");
    if (roEl) {
      roEl.innerHTML = ro.map(function (r) {
        return '<div class="ro"><div class="k">' + esc(r.k) + '</div><div class="v ' + (r.cls || "") + '">' + r.v + "</div></div>";
      }).join("");
    }

    var ov = state.styleOverrides[state.style] || {};
    var st = $("styleTable");
    if (st) {
      var rows = STYLE_EDIT_FIELDS.filter(function (f) {
        return !f.optional || style[f.key] != null;
      }).map(function (f) {
        var live = DATA.styles[state.style] ? DATA.styles[state.style][f.key] : undefined;
        var val = ov[f.key] !== undefined ? ov[f.key] : "";
        var input = '<input type="number" step="0.01" data-stylefield="' + esc(f.key) + '" value="' + esc(val) + '" ' +
          (state.edit ? "" : "disabled") + " />" +
          '<span class="live">live: ' + (live != null ? fmt(live) : "—") + "</span>";
        return "<tr><td>" + esc(f.label) + '</td><td class="num">' + input + "</td></tr>";
      }).join("");
      st.innerHTML =
        "<thead><tr><th>Property</th><th class='num'>Value</th></tr></thead><tbody>" + rows + "</tbody>";
    }
  }

  // ---------------- skills table ----------------

  function renderSkills() {
    var keys = HU.listableSkills().filter(function (k) {
      var s = DATA.skills[k];
      if (state.skillFilter && s.Style !== state.skillFilter) return false;
      if (state.skillSearch && HU.skillDisplay(k).toLowerCase().indexOf(state.skillSearch) === -1) return false;
      return true;
    });
    keys.sort(function (a, b) {
      return HU.skillDisplay(a).localeCompare(HU.skillDisplay(b));
    });
    $("skillCount").textContent = keys.length + " skill" + (keys.length === 1 ? "" : "s");

    var rows = keys.map(function (k) {
      var s = HU.getSkill(k);
      var live = (DATA.skills[k] && DATA.skills[k].SkillData) || {};
      var ov = state.overrides[k] || {};
      var dmg = HU.skillDamage(k);
      var total = dmg * effRatio(k);
      var tags = "";
      if (s.HyperArmour) tags += '<span class="tag hp">HA</span>';
      if (s.GrabSkill) tags += '<span class="tag grab">grab</span>';
      if (s.CounterSkill) tags += '<span class="tag counter">counter</span>';
      if (s.IFrame) tags += '<span class="tag ifr">iframe</span>';
      if (Object.keys(ov).length) tags += '<span class="tag editable-tag">edited</span>';
      var added = state.compare.indexOf(k) !== -1;

      function cell(f, key) {
        var val = ov[f] !== undefined ? ov[f] : "";
        var cls = ov[f] !== undefined ? ' class="editable"' : "";
        var ph = live[key] != null ? live[key] : "";
        return '<td class="num"><input class="skill-edit" data-skill="' + esc(k) + '" data-edit="' + esc(f) + '"' +
          ' type="number" step="0.01" value="' + esc(val) + '" placeholder="' + esc(ph) + '"' +
          ' title="live: ' + esc(live[key] != null ? live[key] : "—") + '"' + cls + " /></td>";
      }

      function hitsCell() {
        var val = ov.hits !== undefined ? ov.hits : "";
        var cls = ov.hits !== undefined ? ' class="editable"' : "";
        var liveH = HU.stageOf(k).hits;
        return '<td class="num"><input class="skill-edit" data-skill="' + esc(k) + '" data-edit="hits"' +
          ' type="number" step="1" min="1" value="' + esc(val) + '" placeholder="' + esc(liveH) + '"' +
          ' title="live: ' + esc(liveH) + '"' + cls + " /></td>";
      }

      return "<tr>" +
        "<td>" + esc(HU.skillDisplay(k)) + tags + "</td>" +
        "<td>" + (s.Style ? esc(styleLabel(s.Style)) : "—") + "</td>" +
        cell("cooldown", "Cooldown") +
        cell("range", "Range") +
        cell("speed", "Speed") +
        cell("power", "Power") +
        '<td class="num"><strong class="dmg-cell">' + fmt(dmg) + "</strong></td>" +
        hitsCell() +
        '<td class="num"><strong class="total-cell">' + fmt(total) + "</strong></td>" +
        '<td class="num">' +
        (added
          ? '<span class="tag hp">added</span>'
          : '<button class="btn" data-add="' + esc(k) + '">Compare</button>') +
        "</td>" +
        "</tr>";
    }).join("");

    $("skillsTable").innerHTML =
      "<thead><tr>" +
      "<th>Skill</th><th>Style</th><th class='num'>CD</th><th class='num'>Range</th>" +
      "<th class='num'>Spd</th><th class='num'>Power</th><th class='num'>Dmg/hit</th>" +
      "<th class='num'>Hits</th><th class='num'>Total</th><th></th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="10" class="hint">No skills match.</td></tr>') + "</tbody>";
  }

  // ---------------- compare list ----------------

  function renderCompare() {
    var list = $("compareList");
    $("compareCount").textContent = state.compare.length + " item" + (state.compare.length === 1 ? "" : "s");
    $("compareEmpty").style.display = state.compare.length ? "none" : "block";
    list.innerHTML = "";

    state.compare.forEach(function (k) {
      var s = HU.getSkill(k);
      var sd = s.SkillData;
      var scaling = HU.getScaling(k, s);
      var dmg = Calc.ComputeSkillDamage({ skill: s, scaling: scaling, stats: state.stats, skillDmg: state.mults.SkillDmg });
      var decay = Calc.GetHitCountDamageDecay(state.scn.HitCount);
      var atkStun = Calc.GetMultiAttackerStunMultiplier(state.scn.Attackers);
      var scnDmg = dmg * effRatio(k) * decay * atkStun;

      var ov = state.overrides[k] || {};

      var editInputs = Object.keys(SD_FIELDS).map(function (f) {
        var val = ov[f] !== undefined ? ov[f] : "";
        return '<label>' + esc(SD_FIELDS[f]) +
          '<input type="number" step="0.01" data-ovfield="' + esc(f) + '" data-skill="' + esc(k) + '" value="' + esc(val) + '" />' +
          '<span class="live">live: ' + fmt(sd[SD_FIELDS[f]]) + "</span></label>";
      }).join("") +
        '<label>Hits' +
        '<input type="number" step="1" min="1" data-ovfield="hits" data-skill="' + esc(k) + '" value="' + esc(ov.hits !== undefined ? ov.hits : "") + '" />' +
        '<span class="live">live: ' + HU.stageOf(k).hits + "</span></label>";

      var scalingBox = "";
      if (DATA.skillScaling[k] || s.Style) {
        var base = DATA.skillScaling[k] || DATA.styles[s.Style] || {};
        var sov = (HU.hasScalingOverride(k) && ov.scaling) || {};
        var scFields = SCALING_FIELDS.map(function (f) {
          var val = sov[f] !== undefined ? sov[f] : "";
          var live = base[f] != null ? base[f] : 0;
          return '<label>' + esc(f.replace("Scaling", "")) +
            '<input type="number" step="0.01" data-scalingfield="' + esc(f) + '" data-skill="' + esc(k) + '" value="' + esc(val) + '" />' +
            '<span class="live">' + (DATA.skillScaling[k] ? "live: " : "style: ") + fmt(live) + "</span></label>";
        }).join("");
        scalingBox =
          "<details class='scaling-box'><summary>Scaling" + (HU.hasScalingOverride(k) ? " (custom)" : "") + "</summary>" +
          "<div class='compare-grid'>" + scFields + "</div></details>";
      }

      var item = document.createElement("div");
      item.className = "compare-item";
      item.innerHTML =
        '<div class="compare-head">' +
        '<span class="name">' + esc(HU.skillDisplay(k)) + ' <span class="tag">' + esc(styleLabel(s.Style || "?")) + "</span></span>" +
        '<span class="dmg">' + fmt(dmg) +
        " <span class='live'>total " + fmt(dmg * effRatio(k)) + " · scenario " + fmt(scnDmg) + " · after def " + fmt(Calc.MitigatedDamage(scnDmg, state.stats)) + "</span></span>" +
        '<button class="btn ghost" data-remove="' + esc(k) + '">Remove</button>' +
        "</div>" +
        "<div class='compare-grid'>" + editInputs + "</div>" +
        scalingBox;
      list.appendChild(item);
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
      return '<div class="ro"><div class="k">' + esc(r.k) + '</div><div class="v small">' + r.v + "</div></div>";
    }).join("");
  }

  // ---------------- analysis ----------------

  function anaDamage(target, st, mults) {
    st = st || state.stats;
    mults = mults || state.mults;
    if (target === "M1") return Calc.ComputeM1Damage({ style: HU.getStyle(state.style), stats: st, basicAttackDmg: mults.BasicAttackDmg });
    if (target === "M2") return Calc.ComputeM2Damage({ style: HU.getStyle(state.style), stats: st, criticalDmg: mults.CriticalDmg });
    if (!DATA.skills[target]) return 0;
    var s = HU.getSkill(target);
    return Calc.ComputeSkillDamage({ skill: s, scaling: HU.getScaling(target, s), stats: st, skillDmg: mults.SkillDmg }) * effRatio(target);
  }

  function renderAnalysis() {
    var t = state.ana.tab;
    HU.ANA_TABS.forEach(function (k) {
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
    HU.listableSkills().forEach(function (k) {
      var s = HU.getSkill(k);
      var sd = s.SkillData;
      var cd = typeof sd.Cooldown === "number" ? sd.Cooldown : 0;
      if (cd <= 0) return;
      var dmg = HU.skillDamage(k);
      var total = dmg * effRatio(k);
      var cycle = Math.max(cd, 1);
      rows.push({ k: k, name: HU.skillDisplay(k), style: s.Style, cd: cd, range: sd.Range, speed: sd.Speed, dmg: dmg, total: total, dps: total / cycle });
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
        "<td>" + esc(r.name) + "</td>" +
        "<td>" + (r.style ? esc(styleLabel(r.style)) : "—") + "</td>" +
        '<td class="num">' + r.cd + '</td><td class="num">' + fmt(r.range) + '</td><td class="num">' + fmt(r.speed) + "</td>" +
        '<td class="num">' + fmt(r.dmg) + "</td>" +
        '<td class="num">' + fmt(r.total) + "</td>" +
        '<td class="num ' + bandV + '"><strong>' + fmt(r.dps) + "</strong></td>" +
        '<td class="num ' + bandV + '">' + relTxt + "</td>" +
        "</tr>";
    }).join("");

    $("dpsTable").innerHTML =
      "<thead><tr>" +
      "<th class='num'>#</th><th>Skill</th><th>Style</th><th class='num'>CD</th>" +
      "<th class='num'>Range</th><th class='num'>Spd</th><th class='num'>Dmg/hit</th>" +
      "<th class='num'>Total</th><th class='num'>DPS</th><th class='num'>vs median</th>" +
      "</tr></thead><tbody>" + html + "</tbody>";
  }

  function renderTTK() {
    var hp = Math.max(1, state.ana.hp);
    var def = Math.min(0.95, Math.max(0, state.ana.def / 100));
    var ehp = hp / (1 - def);

    function decayFor(hits) { return Calc.GetHitCountDamageDecay(hits); }

    function simM1() {
      var style = HU.getStyle(state.style);
      var speed = Math.max(Calc.ScaleGetASMultiplier({ style: style, stats: state.stats, isM2: false }), 0.1);
      var perHit = HU.m1Damage(state.style);
      var t = 0, hits = 0, sum = 0;
      while (sum < ehp && t < 900 && hits < 200000) {
        hits++;
        sum += perHit * decayFor(hits);
        t += 1 / speed;
      }
      return { ttk: t, hits: hits, sum: sum };
    }

    var names = [], damages = [], perHits = [], cds = [], casts = [], hitsList = [];
    state.compare.forEach(function (k) {
      var s = HU.getSkill(k);
      var sd = s.SkillData;
      names.push(HU.skillDisplay(k));
      var perHit = HU.skillDamage(k);
      perHits.push(perHit);
      damages.push(perHit * effRatio(k));
      hitsList.push(effHits(k));
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
      return '<div class="ro"><div class="k">' + esc(r.k) + '</div><div class="v ' + (r.cls || "") + '">' + r.v + "</div></div>";
    }).join("");

    var detail = "";
    if (names.length) {
      detail = '<table class="table ttk-skills"><thead><tr><th>Rotation</th><th class="num">CD</th>' +
        '<th class="num">Cast (est)</th><th class="num">Hits</th><th class="num">Dmg/hit</th><th class="num">Total</th></tr></thead><tbody>' +
        names.map(function (n, i) {
          return "<tr><td>" + esc(n) + '</td><td class="num">' + cds[i] + '</td><td class="num">' + fmt(casts[i]) +
            '</td><td class="num">' + hitsList[i] + '</td><td class="num">' + fmt(perHits[i]) +
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
    var style = HU.getStyle(state.style);

    function bump(stat, amount) {
      var st = Object.assign({}, state.stats);
      st[stat] = Math.max(0, st[stat] + amount);
      return st;
    }
    function row(label, dmg2, delta, note, extra) {
      var d = (typeof dmg2 === "number") ? dmg2 - base : null;
      var pct = (typeof dmg2 === "number" && base > 0) ? (d / base) * 100 : null;
      return "<tr><td>" + esc(label) + "</td>" +
        '<td class="num">' + (typeof base === "number" ? fmt(base) : "—") + "</td>" +
        '<td class="num">' + (typeof dmg2 === "number" ? fmt(dmg2) : "—") + "</td>" +
        '<td class="num">' + (d !== null ? (d > 0 ? "+" : "") + fmt(d) : "—") + "</td>" +
        '<td class="num">' + (pct !== null ? (pct > 0 ? "+" : "") + fmt(pct) + "%" : "—") + "</td>" +
        "<td>" + esc(note || "") + (extra || "") + "</td></tr>";
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
      " · current build deals <strong>" + fmt(current) + "</strong> for “" + esc(targetLabel(target)) + "”.</div>";

    html += '<div class="opt-grid m12">' + top.map(function (o, i) {
      return '<div class="opt-card' + (i === 0 ? " best" : "") + '">' +
        '<div class="o-dmg">' + fmt(o.dmg) + "</div>" +
        '<div class="o-row">STR ' + fmt(o.S) + " · MUS " + fmt(o.M) + " · FAT " + fmt(o.F) + "</div>" +
        (i === 0 ? '<div class="live">best allocation</div>' : "") +
        "</div>";
    }).join("") + "</div>";

    $("optResults").innerHTML = html;
  }

  function targetLabel(target) {
    if (target === "M1") return "M1";
    if (target === "M2") return "M2";
    return DATA.skills[target] ? HU.skillDisplay(target) : target;
  }

  function renderCurves() {
    var target = state.ana.target;

    function seriesOver(stat, lo, hi, step, compute) {
      var pts = [];
      for (var v = lo; v <= hi; v += step) {
        var st = Object.assign({}, state.stats);
        st[stat] = v;
        pts.push({ x: v, y: compute(st) });
      }
      return pts;
    }

    function fig(title, series, xMax, xLabel) {
      return makeChart(title, series, xMax, xLabel);
    }

    var dmg = function (st) { return anaDamage(target, st); };
    var swing = function (st) { return Calc.ScaleGetASMultiplier({ style: HU.getStyle(state.style), stats: st, isM2: false }); };
    var name = targetLabel(target);

    var charts = [];
    charts.push(fig(name + " damage vs Strength", [
      { label: name, color: "#34d399", pts: seriesOver("Strength", 0, 6000, 250, dmg) },
    ], 6000, "Strength"));
    charts.push(fig(name + " damage vs Muscle", [
      { label: name, color: "#34d399", pts: seriesOver("Muscle", 0, 6000, 250, dmg) },
    ], 6000, "Muscle"));
    charts.push(fig(name + " damage vs Fat", [
      { label: name, color: "#34d399", pts: seriesOver("Fat", 0, 6000, 250, dmg) },
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

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" role="img" aria-label="' + esc(title) + '">';
    for (var g = 0; g <= 4; g++) {
      var yy = P + plotH - (g / 4) * plotH;
      svg += '<line x1="' + P + '" y1="' + yy + '" x2="' + (P + plotW) + '" y2="' + yy + '" class="grid"></line>';
      svg += '<text x="' + (P - 5) + '" y="' + (yy + 3) + '" class="axis" text-anchor="end">' + Math.round(maxY * g / 4) + "</text>";
    }
    svg += '<text x="' + (P + plotW) + '" y="' + (H - 3) + '" class="axis" text-anchor="end">' + esc(xLabel + " " + xMax) + "</text>";
    series.forEach(function (s) {
      var pts = s.pts.map(function (p) {
        var x = P + (p.x / xMax) * plotW;
        var y = P + plotH - (p.y / maxY) * plotH;
        return x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      svg += '<polyline points="' + pts + '" class="line" style="stroke:' + s.color + '"></polyline>';
    });
    svg += "</svg>";
    return '<figure class="chart-fig"><figcaption>' + esc(title) + "</figcaption>" + svg + "</figure>";
  }

  // ---------------- Balance Lab ----------------

  function skillSelectOptions(selected) {
    var opts = HU.listableSkills().slice().sort(function (a, b) {
      return HU.skillDisplay(a).localeCompare(HU.skillDisplay(b));
    }).map(function (k) {
      var sel = k === selected ? " selected" : "";
      return '<option value="' + esc(k) + '"' + sel + ">" + esc(HU.skillDisplay(k)) + "</option>";
    }).join("");
    return '<option value="">— choose a skill —</option>' + opts;
  }

  function renderBalance() {
    renderBalanceSkill();
    renderBalanceStyle();
    $("balSkillCount").textContent = state.overrides ? Object.keys(state.overrides).length : 0;
    $("balStyleCount").textContent = state.styleOverrides ? Object.keys(state.styleOverrides).length : 0;
    var bc = $("balCount");
    if (bc) bc.textContent = (Object.keys(state.overrides).length + Object.keys(state.styleOverrides).length) + " edit" +
      (Object.keys(state.overrides).length + Object.keys(state.styleOverrides).length === 1 ? "" : "s");
  }

  function renderBalanceSkill() {
    var sel = $("balSkill");
    if (!sel) return;
    if (!sel.options.length) {
      sel.innerHTML = skillSelectOptions(state.balSkill);
    }
    sel.value = state.balSkill || "";
    var k = state.balSkill;
    var box = $("balSkillFields");
    if (!k || !DATA.skills[k]) { box.innerHTML = '<p class="hint">Pick a skill above to edit its balance values. Edits feed every table, the compare list and all analysis live.</p>'; return; }

    var live = DATA.skills[k];
    var sd = live.SkillData || {};
    var ov = state.overrides[k] || {};
    var stage = HU.stageOf(k);
    var scalingBase = HU.getScaling(k, live);

    function row(label, key, val, liveVal, opts) {
      var editable = (val !== "" && val != null);
      var prefix = label.toLowerCase() === "power" ? "" : "";
      return '<label class="bal-field"><span>' + esc(label) + '</span>' +
        '<input type="number" step="0.01" data-balfield="' + esc(key) + '" data-balskill="' + esc(k) + '" value="' + esc(val) + '" placeholder="' + esc(liveVal) + '" ' + (opts || "") + "/>" +
        '<em class="live">live: ' + fmt(liveVal) + "</em>" +
        (editable ? '<span class="dot" title="edited"></span>' : "") +
        "</label>";
    }

    var html = '<div class="bal-grid">';
    html += row("Power", "power", ov.power !== undefined ? ov.power : "", sd.Power != null ? sd.Power : 0);
    html += row("Cooldown", "cooldown", ov.cooldown !== undefined ? ov.cooldown : "", sd.Cooldown != null ? sd.Cooldown : 0);
    html += row("Range", "range", ov.range !== undefined ? ov.range : "", sd.Range != null ? sd.Range : 0);
    html += row("Speed", "speed", ov.speed !== undefined ? ov.speed : "", sd.Speed != null ? sd.Speed : 0);
    html += row("Hits (decay sim only)", "hits", ov.hits !== undefined ? ov.hits : "", stage.hits, ' min="1"');
    html += "</div>";

    if (DATA.skillScaling[k] || live.Style) {
      var base = DATA.skillScaling[k] || DATA.styles[live.Style] || {};
      var sov = ov.scaling || {};
      html += '<div class="bal-sub"><h4>Stat scaling</h4><div class="bal-grid">';
      SCALING_FIELDS.forEach(function (f) {
        var v = sov[f] !== undefined ? sov[f] : "";
        var lv = base[f] != null ? base[f] : 0;
        html += '<label class="bal-field"><span>' + esc(f.replace("Scaling", "")) + '</span>' +
          '<input type="number" step="0.01" data-balscaling="' + esc(f) + '" data-balskill="' + esc(k) + '" value="' + esc(v) + '" placeholder="' + esc(lv) + '"/>' +
          '<em class="live">live: ' + fmt(lv) + "</em>" +
          (v !== "" && v != null ? '<span class="dot" title="edited"></span>' : "") +
          "</label>";
      });
      html += "</div></div>";
    }

    var dmg = HU.skillDamage(k);
    html += '<div class="bal-summary">' +
      '<span>Dmg/hit <strong>' + fmt(dmg) + "</strong></span>" +
      '<span>Total <strong>' + fmt(dmg * effRatio(k)) + "</strong> (live × " + fmt(effRatio(k)) + ")</span>" +
      '<span>Hits for decay <strong>' + effHits(k) + "</strong></span>" +
      "</div>";

    box.innerHTML = html;
  }

  function renderBalanceStyle() {
    var style = state.style;
    var sel2 = $("balStyle");
    if (sel2) {
      if (!sel2.options.length) {
        sel2.innerHTML = Object.keys(DATA.styles).map(function (k) {
          return '<option value="' + esc(k) + '">' + esc(styleLabel(k)) + "</option>";
        }).join("");
      }
      sel2.value = style;
    }
    var box = $("balStyleFields");
    if (!box) return;
    var liveStyle = DATA.styles[style] || {};
    var ov = state.styleOverrides[style] || {};
    var html = '<div class="bal-grid">';
    STYLE_EDIT_FIELDS.filter(function (f) { return !f.optional || liveStyle[f.key] != null; })
      .forEach(function (f) {
        var v = ov[f.key] !== undefined ? ov[f.key] : "";
        html += '<label class="bal-field"><span>' + esc(f.label) + '</span>' +
          '<input type="number" step="0.01" data-balsfield="' + esc(f.key) + '" value="' + esc(v) + '" placeholder="' + esc(liveStyle[f.key] != null ? liveStyle[f.key] : "—") + '"/>' +
          '<em class="live">live: ' + (liveStyle[f.key] != null ? fmt(liveStyle[f.key]) : "—") + "</em>" +
          (v !== "" && v != null ? '<span class="dot" title="edited"></span>' : "") +
          "</label>";
      });
    html += "</div>";
    box.innerHTML = html;
  }

  // ---------------- exports ----------------

  return {
    renderAll: renderAll,
    renderStylesMatrix: renderStylesMatrix,
    renderStyle: renderStyle,
    renderSkills: renderSkills,
    renderCompare: renderCompare,
    renderScenario: renderScenario,
    renderAnalysis: renderAnalysis,
    renderBalance: renderBalance,
    renderBalanceSkill: renderBalanceSkill,
    renderBalanceStyle: renderBalanceStyle,
    skillSelectOptions: skillSelectOptions,
    anaDamage: anaDamage,
    targetLabel: targetLabel,
  };
})();
