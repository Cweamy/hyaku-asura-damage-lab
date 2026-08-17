--[[
============================================================================
studio-dump.luau — export the live combat data OUT of Studio, into the site.

  Studio (source of truth)  ──dump──▶  combat-calcs-data.dump.json  ──▶  data.js
                                       (this file)      (export-data.js)

Run it in Roblox Studio: paste into the Command Bar, or hand it to the Roblox
MCP `execute_luau` tool (target "edit" works; the module is pure data).

MODES
  "json"    Full dump JSON: { Styles, SkillScaling, Skills, EffectiveFlags }.
            Save the output as website/combat-calcs-data.dump.json, then run
              node export-data.js combat-calcs-data.dump.json
  "digest"  One `Section.Name=hash` line per entry (~6 KB instead of ~50 KB).
            Compare against `node dump-digest.js` to find what drifted since
            the last export, without moving the whole payload around.
  "keys"    Entry counts + names only. Cheap sanity check.

BIG OUTPUTS
  The full JSON is ~50 KB. If your transport truncates it, set CHUNK = 1, 2, 3…
  and concatenate the pieces in order (each result prints its own range).

RESTRICTING OUTPUT
  ONLY = { "Skills.Cleaving_Fang", "Styles.Style_Taekwondo" } limits "json" to
  those entries — handy for verifying a single change after editing Studio.

EffectiveFlags
  CombatCalcsData is not the whole truth for the badge flags the site shows.
  A skill's runtime value is its SkillReg module's field, overridden by
  CombatCalcsData when that table defines the key (see SkillReg.applyOverrides).
  So "json" mode also emits EffectiveFlags: for every skill, the flags that are
  actually true at runtime. A skill missing from EffectiveFlags has none of them
  — that is what lets export-data.js clear a flag that was removed live instead
  of preserving a stale one (Whirl Slam's hyperarmor was stale this way).

NOTE
  `stageData` in data.js is NOT dumped here. It is hand-derived from the
  SkillReg modules (hits per Activate + Σ DamageRatio) and export-data.js keeps
  the existing block when the dump omits it. Update it by hand when a skill's
  hit structure changes.
============================================================================
]]

local MODE: string = "json" -- "json" | "digest" | "keys"
local ONLY: { string }? = nil
local CHUNK: number = 0 -- 0 = whole payload; 1, 2, 3… = that slice only
local CHUNK_SIZE: number = 60000

-- ---------------------------------------------------------------------------

local HttpService = game:GetService("HttpService")
local Data = require(game.ServerScriptService.Modules.CombatCalcsData)
local SkillReg = require(game.ServerScriptService.Modules.VarManager.SkillReg)

local SECTION_NAMES = { "Styles", "SkillScaling", "Skills" }

-- The badge flags website/render.js displays per skill.
local DISPLAY_FLAGS = { "HyperArmour", "GrabSkill", "CounterSkill", "IFrame" }

local function effectiveFlags(): { [string]: { [string]: boolean } }
	local out = {}
	for name in pairs(Data.Skills) do
		local eff = SkillReg.Get(name) -- module fields, already overridden by CombatCalcsData
		if eff then
			local flags, any = {}, false
			for _, key in ipairs(DISPLAY_FLAGS) do
				if eff[key] == true then
					flags[key] = true
					any = true
				end
			end
			if any then
				out[name] = flags
			end
		end
	end
	return out
end

local function sectionOf(name: string)
	return (Data :: any)[name]
end

-- Canonical text form of one entry. Keys sorted, nested tables flattened to
-- dotted paths, numbers printed the same way dump-digest.js prints them — so
-- the Lua hash and the JS hash of identical data are identical.
local function fmtValue(v: any): string
	local t = typeof(v)
	if t == "number" then
		if v == math.floor(v) and math.abs(v) < 1e15 then
			return string.format("%d", v)
		end
		return tostring(v)
	elseif t == "boolean" then
		return v and "true" or "false"
	end
	return tostring(v)
end

local function flatten(tbl: { [any]: any }, prefix: string, out: { string })
	local keys = {}
	for k in pairs(tbl) do
		table.insert(keys, k)
	end
	table.sort(keys, function(a, b)
		return tostring(a) < tostring(b)
	end)
	for _, k in ipairs(keys) do
		local v = tbl[k]
		local key = if prefix == "" then tostring(k) else prefix .. "." .. tostring(k)
		if typeof(v) == "table" then
			flatten(v, key, out)
		else
			table.insert(out, key .. "=" .. fmtValue(v))
		end
	end
end

local function canonical(entry: any): string
	if typeof(entry) ~= "table" then
		return fmtValue(entry)
	end
	local parts: { string } = {}
	flatten(entry, "", parts)
	return table.concat(parts, ",")
end

-- FNV-1a (32-bit), split-multiply so it stays exact in a double.
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

local function sortedKeys(tbl: { [string]: any }): { string }
	local keys = {}
	for k in pairs(tbl) do
		table.insert(keys, k)
	end
	table.sort(keys)
	return keys
end

local function slice(payload: string): string
	if CHUNK <= 0 then
		return payload
	end
	local from = (CHUNK - 1) * CHUNK_SIZE + 1
	local to = math.min(CHUNK * CHUNK_SIZE, #payload)
	if from > #payload then
		return string.format("-- chunk %d empty (payload is %d chars)", CHUNK, #payload)
	end
	return string.format("-- chunk %d: chars %d-%d of %d\n", CHUNK, from, to, #payload) .. string.sub(payload, from, to)
end

-- ---------------------------------------------------------------------------

if MODE == "keys" then
	local lines = {}
	for _, section in ipairs(SECTION_NAMES) do
		local tbl = sectionOf(section)
		local keys = sortedKeys(tbl)
		table.insert(lines, string.format("%s (%d): %s", section, #keys, table.concat(keys, ", ")))
	end
	return table.concat(lines, "\n\n")
elseif MODE == "digest" then
	local lines = {}
	for _, section in ipairs(SECTION_NAMES) do
		local tbl = sectionOf(section)
		for _, name in ipairs(sortedKeys(tbl)) do
			table.insert(lines, string.format("%s.%s=%s", section, name, fnv1a(canonical(tbl[name]))))
		end
	end
	return table.concat(lines, "\n")
end

-- MODE == "json"
local dump: { [string]: any } = {}
if ONLY and #ONLY > 0 then
	local wanted: { [string]: { [string]: boolean } } = {}
	for _, path in ipairs(ONLY) do
		local section, name = string.match(path, "^([^.]+)%.(.+)$")
		if section and name then
			wanted[section] = wanted[section] or {}
			wanted[section][name] = true
		end
	end
	for section, names in pairs(wanted) do
		local src = sectionOf(section)
		if src then
			dump[section] = {}
			for name in pairs(names) do
				dump[section][name] = src[name]
			end
		end
	end
else
	for _, section in ipairs(SECTION_NAMES) do
		dump[section] = sectionOf(section)
	end
	dump.EffectiveFlags = effectiveFlags()
end

return slice(HttpService:JSONEncode(dump))
