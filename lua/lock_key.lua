--[[
  lock_key.lua  v4
  ─────────────────────────────────────────────────────────────────────────────
  Called ONLY on upstream error (4xx / 5xx).
  Flags the failed model and checks whether other models on the same key remain.

  Rules:
    - Set a per-model error flag (m{idx}:failed) so acquire_slot skips it.
    - Advance midx to the next model.
    - If at least one other model is NOT flagged failed → return "rotated"
      (key is still usable; balancer will retry immediately).
    - If ALL models on this key are flagged failed → lock the key for lockTtl.
      The key unlocks automatically when the TTL expires.

  KEYS[1] = prefix
  ARGV[1] = keyId
  ARGV[2] = failed model index (0-based)
  ARGV[3] = total model count
  ARGV[4] = lock TTL in seconds

  Returns: "rotated" | "all_exhausted"
]]

local prefix      = KEYS[1]
local keyId       = ARGV[1]
local failedMIdx  = tonumber(ARGV[2])
local numModels   = tonumber(ARGV[3])
local lockTtl     = tonumber(ARGV[4])

local midxK   = prefix .. ":key:" .. keyId .. ":midx"
local lockK   = prefix .. ":key:" .. keyId .. ":lock"

local failedK = prefix .. ":key:" .. keyId .. ":m" .. failedMIdx .. ":failed"
redis.call("SET", failedK, "1")

local nextMIdx = (failedMIdx + 1) % numModels
redis.call("SET", midxK, tostring(nextMIdx))

for i = 0, numModels - 1 do
  if i ~= failedMIdx then
    local otherFailedK = prefix .. ":key:" .. keyId .. ":m" .. i .. ":failed"
    if redis.call("GET", otherFailedK) ~= "1" then
      return "rotated"
    end
  end
end

redis.call("SET", lockK, "1", "EX", lockTtl)
return "all_exhausted"
