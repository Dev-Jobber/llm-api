--[[
  acquire_slot.lua  v4
  ─────────────────────────────────────────────────────────────────────────────
  Round-robin slot acquisition. Rounds are a rotation hint, never a lock cause.

  Flow:
    1. Read rr_ptr — starting key index.
    2. Walk all keys. Skip failure-locked ones.
    3. For each unlocked key, walk models from its midx.
       Skip any model flagged with m{idx}:failed (error-mark from lock_key.lua).
       For non-failed models, find first where rounds < maxRounds.
    4. INCR rounds, advance rr_ptr, return slot.
    5. If a model is error-marked, rotate midx past it and clear the flag.
    6. If a model is naturally exhausted (rounds >= max),
       rotate midx to next model and RESET that model's counter
       so it can be reused — never lock for round exhaustion.
    7. Return "none" only when ALL keys have an active failure lock.

  Keys:
    {prefix}:rr_ptr
    {prefix}:key:{id}:lock       (set only by lock_key.lua on upstream error)
    {prefix}:key:{id}:midx
    {prefix}:key:{id}:m{idx}:rounds
    {prefix}:key:{id}:m{idx}:failed
]]

local prefix    = KEYS[1]
local keyIds    = cjson.decode(ARGV[1])
local models    = cjson.decode(ARGV[2])
local maxRounds = tonumber(ARGV[3])
local numKeys   = tonumber(ARGV[4])
local numModels = #models

local rrPtrK   = prefix .. ":rr_ptr"
local startPtr = tonumber(redis.call("GET", rrPtrK) or "0") or 0

for attempt = 0, numKeys - 1 do
  local keySlot = (startPtr + attempt) % numKeys
  local keyId   = keyIds[keySlot + 1]
  local lockK   = prefix .. ":key:" .. keyId .. ":lock"

  if redis.call("EXISTS", lockK) == 0 then
    local midxK = prefix .. ":key:" .. keyId .. ":midx"
    local mIdx  = tonumber(redis.call("GET", midxK) or "0") or 0

    for mAttempt = 0, numModels - 1 do
      local realMIdx = (mIdx + mAttempt) % numModels
      local failedK  = prefix .. ":key:" .. keyId .. ":m" .. realMIdx .. ":failed"

      if redis.call("GET", failedK) == "1" then
        local nextMIdx = (realMIdx + 1) % numModels
        redis.call("SET", midxK, tostring(nextMIdx))
        redis.call("DEL", failedK)
      else
        local roundsK  = prefix .. ":key:" .. keyId .. ":m" .. realMIdx .. ":rounds"
        local used     = tonumber(redis.call("GET", roundsK) or "0") or 0

        if used < maxRounds then
          redis.call("INCR", roundsK)
          redis.call("SET", rrPtrK, tostring((keySlot + 1) % numKeys))
          redis.call("SET", midxK, tostring(realMIdx))
          return { "ok", keyId, models[realMIdx + 1], tostring(realMIdx) }
        else
          local nextMIdx = (realMIdx + 1) % numModels
          redis.call("SET", midxK, tostring(nextMIdx))
          redis.call("SET", roundsK, "0")
        end
      end
    end
  end
end

return { "none" }
