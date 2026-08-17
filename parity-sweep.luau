--[[
============================================================================
parity-sweep.luau — prove website/calc.js still matches the live formulas.

  Studio: CombatCalculation ──sweep──▶ rows ──▶ node parity-check.js --live …

`studio-dump.luau` keeps the DATA in sync; this keeps the MATH in sync. Run it
in Studio (Command Bar or the Roblox MCP `execute_luau`) and feed the output to
`node parity-check.js --live <file>`, which recomputes every row through calc.js
and reports any formula that drifted.

MODE
  "hash"  (default) prints just `rows=<n> hash=<h>`. Compare with
          `node parity-check.js` — equal hashes mean every row matches, which
          is the cheap everyday check.
  "rows"  prints `key<TAB>scaled-value` for every row. Use it when the hashes
          disagree and you need to see *which* formula moved.

Values are compared as round(value * 1e6) integers, so both languages agree
exactly without depending on float-to-string formatting.
============================================================================
]]

local MODE: string = "hash" -- "hash" | "rows"

local CombatCalculation = require(game.ServerScriptService.Modules.CombatCalculation)
local Data = require(game.ServerScriptService.Modules.CombatCalcsData)

-- Profiles must stay identical to PROFILES in parity-check.js.
local PROFILES = {
	{
		name = "P1",
		stats = { Strength = 2000, Muscle = 2000, Fat = 300, Agility = 1000, AttackSpeed = 1000, Durability = 1000, StaminaInStat = 1000, MaxStamina = 100 },
	},
	{
		name = "P2",
		stats = { Strength = 4000, Muscle = 3500, Fat = 1200, Agility = 400, AttackSpeed = 300, Durability = 2500, StaminaInStat = 2000, MaxStamina = 150 },
	},
}

-- CombatCalculation.ReadStat expects an Instance, so build real NumberValues.
local function statsFolder(tbl: { [string]: number }): Folder
	local folder = Instance.new("Folder")
	for name, value in pairs(tbl) do
		local nv = Instance.new("NumberValue")
		nv.Name = name
		nv.Value = value
		nv.Parent = folder
	end
	return folder
end

-- ScaleGetASMultiplier reads Attributes.MuscleAndFatAttackSpeedDebuffEfficiency.Value
-- directly (CombatCalculation:449) — it is not nil-guarded, so pass a real folder.
local function attributesFolder(): Folder
	local folder = Instance.new("Folder")
	local nv = Instance.new("NumberValue")
	nv.Name = "MuscleAndFatAttackSpeedDebuffEfficiency"
	nv.Value = 0
	nv.Parent = folder
	return folder
end

local rows: { string } = {}
local function row(key: string, value: number)
	table.insert(rows, key .. "\t" .. string.format("%d", math.floor((value or 0) * 1e6 + 0.5)))
end

local function sortedKeys(tbl): { string }
	local keys = {}
	for k in pairs(tbl) do
		table.insert(keys, k)
	end
	table.sort(keys)
	return keys
end

local styleNames = sortedKeys(Data.Styles)
local skillNames = sortedKeys(Data.Skills)

for _, profile in ipairs(PROFILES) do
	local P = profile.name
	local stats = statsFolder(profile.stats)
	local attributes = attributesFolder()

	for _, stat in ipairs({ "Strength", "Muscle", "Fat" }) do
		row("EffStat/" .. stat .. "/" .. P, CombatCalculation.EffectiveStat(profile.stats[stat], CombatCalculation.StatLimits[stat]))
	end
	row("StrEff/" .. P, CombatCalculation.GetStrengthEffectiveness(profile.stats.Muscle))

	for _, name in ipairs(styleNames) do
		local style = Data.Styles[name]
		row("M1/" .. name .. "/" .. P, CombatCalculation.ComputeM1Damage({ Style = style, Stats = stats, BasicAttackDmg = 1 }))
		row("M2/" .. name .. "/" .. P, CombatCalculation.ComputeM2Damage({ Style = style, Stats = stats, CriticalDmg = 1 }))
		row("DrainM1/" .. name .. "/" .. P, CombatCalculation.GetStamDrain({ Style = style, Stats = stats, Attack = "M1" }))
		row("DrainM2/" .. name .. "/" .. P, CombatCalculation.GetStamDrain({ Style = style, Stats = stats, Attack = "M2" }))
		row("AS1/" .. name .. "/" .. P, CombatCalculation.ScaleGetASMultiplier({ Style = style, Stats = stats, IsM2 = false, Attributes = attributes }))
		row("AS2/" .. name .. "/" .. P, CombatCalculation.ScaleGetASMultiplier({ Style = style, Stats = stats, IsM2 = true, Attributes = attributes }))
	end

	for _, name in ipairs(skillNames) do
		-- Block stores SkillData.Power as { Base, Affect } rather than a number, and
		-- ComputeSkillDamage's un-flattened path would multiply a table. The live game
		-- never hits it (CalculateSkillStats passes an already-resolved Power), so the
		-- row is skipped on both sides rather than compared through a broken path.
		local entry = Data.Skills[name]
		if typeof(entry.SkillData) == "table" and typeof(entry.SkillData.Power) == "number" then
			row("Skill/" .. name .. "/" .. P, CombatCalculation.ComputeSkillDamage({ SkillName = name, Skill = entry, Stats = stats }))
		end
	end

	row("DefDur/" .. P, CombatCalculation.GetDurabilityDefense(stats))
	row("DefMus/" .. P, CombatCalculation.GetMuscleDefense(stats))
	row("DefFat/" .. P, CombatCalculation.GetFatDefense(stats))
	row("BlockDrain/" .. P, CombatCalculation.GetBlockHitStamDrain({ Stats = stats, Damage = 100 }))
	row("RunDrain/" .. P, CombatCalculation.GetRunStamDrain({ Stats = stats, DeltaTime = 1 / 60, Boosted = false }))
	row("RunDrainBoost/" .. P, CombatCalculation.GetRunStamDrain({ Stats = stats, DeltaTime = 1 / 60, Boosted = true }))
	row("ASProgress/" .. P, CombatCalculation.GetAttackSpeedProgress(profile.stats.AttackSpeed))
	row("ASStun/" .. P, CombatCalculation.GetAttackSpeedStunMultiplier(stats))

	stats:Destroy()
	attributes:Destroy()
end

for _, n in ipairs({ 1, 5, 9, 10, 15, 19, 20, 28, 37, 46, 50, 80 }) do
	row("Decay/" .. n, CombatCalculation.GetHitCountDamageDecay(n))
end
for _, n in ipairs({ 1, 2, 3, 4, 6 }) do
	row("MultiStun/" .. n, CombatCalculation.GetMultiAttackerStunMultiplier(n))
end
for _, n in ipairs({ 0, 25, 50, 75, 100 }) do
	row("Rhythm/" .. n, CombatCalculation.GetRhythmStamMul(n))
end
row("SkillLanded", CombatCalculation.GetSkillLandedStamMul())
row("SkillMulNil", CombatCalculation.SkillStatMultiplier(nil, statsFolder(PROFILES[1].stats)))

local text = table.concat(rows, "\n")

local function fnv1a(s: string): string
	local h = 2166136261
	for i = 1, #s do
		h = bit32.bxor(h, string.byte(s, i))
		local lo = bit32.band(h, 0xFFFF)
		local hi = bit32.rshift(h, 16)
		h = bit32.band(lo * 16777619 + bit32.lshift(bit32.band(hi * 16777619, 0xFFFF), 16), 0xFFFFFFFF)
	end
	return string.format("%08x", h)
end

if MODE == "rows" then
	return text
end
return string.format("rows=%d hash=%s", #rows, fnv1a(text))
