// ============================================================================
// Hyaku Asura — Damage calc (mirror of game.ServerScriptService.Modules.CombatCalculation)
// Source: live Roblox Studio module, 2026-08-10. Kept 1:1 with the Lua formulas.
// ============================================================================
window.HyakuCalc = (function () {
  "use strict";

  var C = window.HYAKU_DATA.constants;

  var M1Bonus = C.M1Bonus;            // 3.5
  var M2Bonus = C.M2Bonus;            // 3.9
  var SkillBonus = C.SkillBonus;      // 6
  var M2GlobalMultiplier = C.M2GlobalMultiplier; // 1.12

  var StrEffPenaltyStartMuscle = C.StrEffPenaltyStartMuscle;
  var StrEffPenaltyKneeMuscle = C.StrEffPenaltyKneeMuscle;
  var StrEffPenaltyCapMuscle = C.StrEffPenaltyCapMuscle;
  var StrEffPenaltyAtKnee = C.StrEffPenaltyAtKnee;
  var StrEffPenaltyAtCap = C.StrEffPenaltyAtCap;

  var LeanBonus = C.LeanBonus;
  var LeanStrengthBonus = C.LeanStrengthBonus;
  var LeanCriticalBonus = C.LeanCriticalBonus;

  var MuscleStrengthNerfCap = C.MuscleStrengthNerfCap;
  var MuscleStrengthNerfRef = C.MuscleStrengthNerfRef;

  var M1BaseDrainPct = 0.015;
  var M1MuscleDrainPct = 0.005;
  var M1StrengthDrainPct = 0.006;
  var M1FatDrainPct = 0.013;

  var M2BaseDrainPct = 0.025;
  var M2MuscleDrainPct = 0.013;
  var M2StrengthDrainPct = 0.010;
  var M2FatDrainPct = 0.016;

  var RunBaseDrainPct = 0.010;
  var RunSizeDrainPct = 0.020;
  var RunBoostedMul = 1.55;

  var MuscleDRCap = C.MuscleDRCap;
  var MuscleDRRef = C.MuscleDRRef;
  var FatDRCap = C.FatDRCap;
  var FatDRRef = C.FatDRRef;

  var AttackSpeedRawCap = C.AttackSpeedRawCap;
  var AttackSpeedASMaxBonus = C.AttackSpeedASMaxBonus;
  var AttackSpeedLeanCap = C.AttackSpeedLeanCap;
  var AttackSpeedMaxMuscleScale = C.AttackSpeedMaxMuscleScale;
  var AttackSpeedMaxFatScale = C.AttackSpeedMaxFatScale;
  var AttackSpeedMaxSizePenalty = C.AttackSpeedMaxSizePenalty;
  var AttackSpeedMaxFatExtraPenalty = C.AttackSpeedMaxFatExtraPenalty;
  var AttackSpeedMaxMuscleExtraPenalty = C.AttackSpeedMaxMuscleExtraPenalty;
  var AttackSpeedASBonusBulkDampen = C.AttackSpeedASBonusBulkDampen;
  var AttackSpeedBulkStyleFloorDrop = C.AttackSpeedBulkStyleFloorDrop;
  var AttackSpeedMaxFinalSpeed = C.AttackSpeedMaxFinalSpeed;
  var AttackSpeedMinFinalSpeed = C.AttackSpeedMinFinalSpeed;

  var AttackSpeedMaxStunReduction = C.AttackSpeedMaxStunReduction;
  var RhythmMaxStamReduction = C.RhythmMaxStamReduction;
  var SkillLandedDiscount = C.SkillLandedDiscount;

  var StatLimits = window.HYAKU_DATA.statLimits;

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  // Stats is a plain object { Strength, Muscle, Fat, Agility, AttackSpeed, Durability, StaminaInStat, MaxStamina }.
  function ReadStat(stats, name) {
    var v = stats ? stats[name] : undefined;
    return (typeof v === "number" && isFinite(v)) ? v : 0;
  }

  // CombatCalculation.EffectiveStat
  function EffectiveStat(raw, brackets) {
    var Capped = Math.max(raw || 0, 0);
    var Total = 0;
    var Last = 0;
    for (var i = 0; i < brackets.length; i++) {
      var B = brackets[i];
      if (Capped <= B.Max) {
        Total += (Capped - Last) * B.Mult;
        return Total;
      }
      Total += (B.Max - Last) * B.Mult;
      Last = B.Max;
    }
    return Total;
  }

  // CombatCalculation.GetStrengthEffectiveness
  function GetStrengthEffectiveness(muscle) {
    var M = Math.max(muscle || 0, 0);
    if (M <= StrEffPenaltyStartMuscle) return 1;
    if (M >= StrEffPenaltyCapMuscle) return 1 - StrEffPenaltyAtCap;
    var Penalty;
    if (M <= StrEffPenaltyKneeMuscle) {
      Penalty = (M - StrEffPenaltyStartMuscle) / (StrEffPenaltyKneeMuscle - StrEffPenaltyStartMuscle) * StrEffPenaltyAtKnee;
    } else {
      Penalty = StrEffPenaltyAtKnee + (M - StrEffPenaltyKneeMuscle) / (StrEffPenaltyCapMuscle - StrEffPenaltyKneeMuscle) * (StrEffPenaltyAtCap - StrEffPenaltyAtKnee);
    }
    return 1 - Penalty;
  }

  // CombatCalculation.SkillStatMultiplier
  function SkillStatMultiplier(Scaling, Stats) {
    if (!Scaling) return 0.75 * SkillBonus;
    var Muscle = ReadStat(Stats, "Muscle");

    var Str = EffectiveStat(ReadStat(Stats, "Strength"), StatLimits.Strength);
    var Mus = EffectiveStat(Muscle, StatLimits.Muscle);
    var Fat = EffectiveStat(ReadStat(Stats, "Fat"), StatLimits.Fat);
    var StrAmt = (Str / 1000) * (Scaling.StrengthScaling != null ? Scaling.StrengthScaling : 1) * (Muscle > 1000 ? 0.5 : 1) * GetStrengthEffectiveness(Muscle);
    var MusAmt = (Mus / 1400) * (((Scaling.UpperMuscleScaling != null ? Scaling.UpperMuscleScaling : 1) + (Scaling.LowerMuscleScaling != null ? Scaling.LowerMuscleScaling : 1)) / 2);
    var FatAmt = (Fat / 1500) * (Scaling.FatScaling != null ? Scaling.FatScaling : 1);
    return (1 + StrAmt + MusAmt + FatAmt) * 0.75 * SkillBonus;
  }

  // CombatCalculation.StrikeStatMultiplier
  function StrikeStatMultiplier(Scaling, Stats) {
    if (!Scaling) return 1;
    var Str = EffectiveStat(ReadStat(Stats, "Strength"), StatLimits.Strength);
    var Mus = EffectiveStat(ReadStat(Stats, "Muscle"), StatLimits.Muscle);
    var Fat = EffectiveStat(ReadStat(Stats, "Fat"), StatLimits.Fat);
    var StrAmt = (Str / 700) * (Scaling.StrengthScaling != null ? Scaling.StrengthScaling : 1) * GetStrengthEffectiveness(ReadStat(Stats, "Muscle"));
    var MusAmt = (Mus / 1000) * (((Scaling.UpperMuscleScaling != null ? Scaling.UpperMuscleScaling : 1) + (Scaling.LowerMuscleScaling != null ? Scaling.LowerMuscleScaling : 1)) / 2);
    var FatAmt = (Fat / 700) * (Scaling.FatScaling != null ? Scaling.FatScaling : 1);
    return (1 + StrAmt + MusAmt + FatAmt) * 0.75;
  }

  // CombatCalculation.ComputeM1Damage
  function ComputeM1Damage(Opts) {
    var O = Opts || {};
    var Style = O.style || O.styleName;
    if (!Style) return 0;
    var Base = Style.BaseDamageM1 != null ? Style.BaseDamageM1 : 5.75;
    var Stats = O.stats;
    if (!Stats) return Base;
    var Muscle = ReadStat(Stats, "Muscle");
    var Fat = ReadStat(Stats, "Fat");
    var TMThreshold = Style.TMThreshold;
    var FatThreshold = Style.FatThreshold;
    if (TMThreshold && TMThreshold > 0 && Muscle < TMThreshold) Base *= 0.7;
    if (FatThreshold && FatThreshold > 0 && Fat < FatThreshold) Base *= 0.7;
    var Mult = StrikeStatMultiplier(Style, Stats);
    var AtkAttrMul = O.basicAttackDmg != null ? O.basicAttackDmg : 1;
    return Base * Mult * AtkAttrMul * M1Bonus;
  }

  // CombatCalculation.ComputeM2Damage
  function ComputeM2Damage(Opts) {
    var O = Opts || {};
    var Style = O.style || O.styleName;
    if (!Style) return 0;
    var M1 = ComputeM1Damage({ style: Style, stats: O.stats, basicAttackDmg: O.criticalDmg });
    return M1 * M2GlobalMultiplier;
  }

  // CombatCalculation.ComputeSkillDamage
  function ComputeSkillDamage(Opts) {
    var O = Opts || {};
    var Scaling = O.scaling;
    if (!Scaling && O.skillName) Scaling = window.HYAKU_DATA.skillScaling[O.skillName];
    if (!Scaling && O.skill && O.skill.Style) Scaling = window.HYAKU_DATA.styles[O.skill.Style];
    if (!Scaling && O.styleName) Scaling = window.HYAKU_DATA.styles[O.styleName];
    var Base = O.power;
    if (Base == null && O.skill && O.skill.SkillData && O.skill.SkillData.Power != null) Base = O.skill.SkillData.Power;
    if (Base == null) Base = 1;
    var Stats = O.stats;
    if (!Stats) return Base;
    var Mult = SkillStatMultiplier(Scaling, Stats);
    var Attr = O.skillDmg != null ? O.skillDmg : 1;
    return Base * Mult * Attr;
  }

  // CombatCalculation.GetM1StamDrain / GetM2StamDrain (2026-08-11: the old
  // StaminaScaling-based GetStamDrain had no live equivalent; StaminaScaling is
  // dead data in the live codebase. Attack "M1" -> GetM1StamDrain, else GetM2StamDrain).
  function GetStamDrain(Opts) {
    var O = Opts || {};
    var Style = O.style || O.styleName;
    var Stats = O.stats;
    if (!Style || !Stats) return 0;
    var MaxStam = ReadStat(Stats, "MaxStamina");
    var Muscle = ReadStat(Stats, "Muscle");
    var Strength = ReadStat(Stats, "Strength");
    var Fat = ReadStat(Stats, "Fat");
    if ((O.attack || "M1") === "M2") {
      var Pct2 = M2BaseDrainPct
        + clamp(Muscle / 3000, 0, 2.5) * M2MuscleDrainPct
        + clamp(Strength / 3000, 0, 2.5) * M2StrengthDrainPct
        + clamp(Fat / 1500, 0, 2.5) * M2FatDrainPct;
      return MaxStam * Pct2 + (Style.M2StaminaCost != null ? Style.M2StaminaCost : 6.5);
    }
    var Pct1 = M1BaseDrainPct
      + clamp(Muscle / 6000, 0, 2.5) * M1MuscleDrainPct
      + clamp(Strength / 3000, 0, 2.5) * M1StrengthDrainPct
      + clamp(Fat / 1500, 0, 2.5) * M1FatDrainPct;
    return MaxStam * Pct1 + (Style.M1StaminaCost != null ? Style.M1StaminaCost : 4);
  }

  function GetBlockHitStamDrain(Opts) {
    var O = Opts || {};
    var Stats = O.stats;
    if (!Stats) return 0;
    var Damage = O.damage || 0;
    var Dura = ReadStat(Stats, "Durability");
    var EffDura = EffectiveStat(Dura, StatLimits.Durability);
    var Resist = 1 / (1 + EffDura / 1500);
    var DrainPct = (Math.max(0.5, Damage * 0.18) * Resist + 0.7) * 0.49;

    var DefenderMuscle = ReadStat(Stats, "Muscle");
    var AttackerMuscle = O.attackerStats ? ReadStat(O.attackerStats, "Muscle") : undefined;
    if (AttackerMuscle != null && AttackerMuscle > 240 && DefenderMuscle <= 240) DrainPct *= 1.10;
    else if (AttackerMuscle != null && AttackerMuscle <= 240 && DefenderMuscle > 240) DrainPct *= 0.85;

    return DrainPct;
  }

  function GetRunStamDrain(Opts) {
    var O = Opts || {};
    var Stats = O.stats;
    if (!Stats) return 0;
    var MaxStam = ReadStat(Stats, "MaxStamina");
    var Muscle = ReadStat(Stats, "Muscle");
    var Fat = ReadStat(Stats, "Fat");
    var Agility = ReadStat(Stats, "Agility");
    var Size = Muscle + Fat;
    var SizePenalty = clamp(Size / 8000, 0, 1.1);
    var AgilityPenalty = clamp(Agility / 8000, 0, 0.5) * 0.005;
    var DrainPerSec = MaxStam * (RunBaseDrainPct + SizePenalty * RunSizeDrainPct + AgilityPenalty);
    var DeltaTime = O.deltaTime || (1 / 60);
    var Drain = DrainPerSec * DeltaTime;
    if (O.boosted) Drain *= RunBoostedMul;
    return Drain;
  }

  function GetDurabilityDefense(Stats) {
    if (!Stats) return 0;
    var Dura = ReadStat(Stats, "Durability");
    var EffDura = EffectiveStat(Dura, StatLimits.Durability);
    return clamp(EffDura / 3400, 0, 1.6);
  }

  function GetMuscleDefense(Stats) {
    if (!Stats) return 0;
    var Muscle = ReadStat(Stats, "Muscle");
    return clamp(Muscle / MuscleDRRef, 0, 1) * MuscleDRCap;
  }

  function GetFatDefense(Stats) {
    if (!Stats) return 0;
    var Fat = ReadStat(Stats, "Fat");
    return clamp(Fat / FatDRRef, 0, 1) * FatDRCap;
  }

  function GetAttackSpeedProgress(rawAS) {
    var Capped = clamp(rawAS || 0, 0, AttackSpeedRawCap);
    return Math.sqrt(Capped / AttackSpeedRawCap);
  }

  // CombatCalculation.ScaleGetASMultiplier.
  // attributes.muscleAndFatAttackSpeedDebuffEfficiency mirrors the live IntValue (default 0).
  function ScaleGetASMultiplier(Opts) {
    var O = Opts || {};
    var Style = O.style || O.styleName;
    var Stats = O.stats;
    if (!Style || !Stats) return 1;
    var RawAS = ReadStat(Stats, "AttackSpeed");
    var ASProgress = GetAttackSpeedProgress(RawAS);
    var BaseSpeed = (O.isM2 ? Style.M2Speed : Style.M1Speed) != null ? (O.isM2 ? Style.M2Speed : Style.M1Speed) : 1;
    var MaxScale = (O.isM2 ? Style.M2MaxAttackSpeedScale : Style.MaxAttackSpeedScale) != null ? (O.isM2 ? Style.M2MaxAttackSpeedScale : Style.MaxAttackSpeedScale) : 1;
    var Muscle = ReadStat(Stats, "Muscle");
    var Fat = ReadStat(Stats, "Fat");
    var Attributes = O.attributes || {};
    var debuffEff = Attributes.muscleAndFatAttackSpeedDebuffEfficiency || 0;

    var VeryBig = (Muscle + Fat) * (1 + debuffEff);
    var SizeRange = AttackSpeedMaxMuscleScale + AttackSpeedMaxFatScale;
    var SizeRatio = clamp((VeryBig - AttackSpeedLeanCap) / SizeRange, 0, 1);
    var SizePenalty = SizeRatio * AttackSpeedMaxSizePenalty;
    var FatRatio = clamp(Fat / 2500, 0, 1);
    var FatPenalty = FatRatio * AttackSpeedMaxFatExtraPenalty;

    var MusclePenalty = Math.pow(0.95, map(Muscle, 0, 2000, 0, 1));
    var ASBonus = ASProgress * AttackSpeedASMaxBonus * (1 - SizeRatio * AttackSpeedASBonusBulkDampen);
    var Calc = BaseSpeed * MusclePenalty + ASBonus - SizePenalty - FatPenalty;
    var BulkStyleFloor = MaxScale * (1 - SizeRatio * AttackSpeedBulkStyleFloorDrop);
    var Final = Math.max(BulkStyleFloor, Calc);
    var Result = clamp(Final, AttackSpeedMinFinalSpeed, AttackSpeedMaxFinalSpeed);
    return Result * (1 - FatRatio * 0.10);
  }

  function GetAttackSpeedStunMultiplier(Stats) {
    if (!Stats) return 1;
    var RawAS = ReadStat(Stats, "AttackSpeed");
    var Progress = clamp(RawAS, 0, AttackSpeedRawCap) / AttackSpeedRawCap;
    return clamp(1 - Progress * AttackSpeedMaxStunReduction, 1 - AttackSpeedMaxStunReduction, 1.0);
  }

  // HitCount decay: live 2026-08-11 curve: N<=9 -> 1.0, then tiers of 9 -> -0.08,
  // floor 0.5. (Re-synced 2026-08-11; the site previously carried the old curve
  // N<=14 -> -0.05 floor 0.65.)
  function GetHitCountDamageDecay(hitCount) {
    var N = Math.max(hitCount || 0, 0);
    if (N <= 9) return 1.0;
    var Tier = Math.floor((N - 1) / 9);
    return Math.max(0.5, 1.0 - Tier * 0.08);
  }

  function GetMultiAttackerStunMultiplier(attackerCount) {
    var N = Math.max(attackerCount || 1, 1);
    if (N <= 1) return 1.0;
    return Math.min(1.5 * (N - 1), 8.0);
  }

  function GetRhythmStamMul(rhythmCharge) {
    var Ratio = clamp((rhythmCharge || 0) / 100, 0, 1);
    return 1 - Ratio * RhythmMaxStamReduction;
  }

  function GetSkillLandedStamMul() {
    return 1 - SkillLandedDiscount;
  }

  // ---------- helpers (web only; not in the live module) ----------

  function map(v, a, b, c, d) {
    if (b - a === 0) return d;
    return c + (d - c) * ((v - a) / (b - a));
  }

  // Sum of the three defense components. The live game applies these in the
  // damage pipeline; this is the web-approximation used for the "after defense" readout.
  function TotalDefense(stats) {
    return clamp(GetDurabilityDefense(stats) + GetMuscleDefense(stats) + GetFatDefense(stats), 0, 1);
  }

  function MitigatedDamage(raw, stats) {
    return raw * (1 - TotalDefense(stats));
  }

  return {
    M1Bonus: M1Bonus,
    M2Bonus: M2Bonus,
    SkillBonus: SkillBonus,
    M2GlobalMultiplier: M2GlobalMultiplier,
    EffectiveStat: EffectiveStat,
    ReadStat: ReadStat,
    GetStrengthEffectiveness: GetStrengthEffectiveness,
    SkillStatMultiplier: SkillStatMultiplier,
    StrikeStatMultiplier: StrikeStatMultiplier,
    ComputeM1Damage: ComputeM1Damage,
    ComputeM2Damage: ComputeM2Damage,
    ComputeSkillDamage: ComputeSkillDamage,
    GetStamDrain: GetStamDrain,
    GetBlockHitStamDrain: GetBlockHitStamDrain,
    GetRunStamDrain: GetRunStamDrain,
    GetDurabilityDefense: GetDurabilityDefense,
    GetMuscleDefense: GetMuscleDefense,
    GetFatDefense: GetFatDefense,
    TotalDefense: TotalDefense,
    MitigatedDamage: MitigatedDamage,
    GetAttackSpeedProgress: GetAttackSpeedProgress,
    ScaleGetASMultiplier: ScaleGetASMultiplier,
    GetAttackSpeedStunMultiplier: GetAttackSpeedStunMultiplier,
    GetHitCountDamageDecay: GetHitCountDamageDecay,
    GetMultiAttackerStunMultiplier: GetMultiAttackerStunMultiplier,
    GetRhythmStamMul: GetRhythmStamMul,
    GetSkillLandedStamMul: GetSkillLandedStamMul,
    clamp: clamp,
  };
})();
