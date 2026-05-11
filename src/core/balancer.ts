import axios, { AxiosError } from "axios";
import type Redis from "ioredis";
import {
  config,
  MODELS,
  API_BASE_URL,
  API_CHAT_PATH,
  DEFAULTS,
  type Model,
} from "../config/index.js";
import type { LoadedScripts } from "./scripts.js";
import { extractJsonBlocks } from "./json-parser.js";

const DEFAULT_JSON_SYSTEM_PROMPT = "Return your response as a valid JSON object inside a JSON code block (\\`\\`\\`json).";

const PREFIX = "ai_lb";
const KEY_IDS = config.apiKeys.map((_, i) => `k${i}`);
const KEY_MAP: Record<string, string> = Object.fromEntries(
  config.apiKeys.map((key, i) => [`k${i}`, key])
);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: Model;
  return_json?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface SlotInfo {
  keyId: string;
  model: Model;
  modelIndex: number;
}

type AcquireRaw = ["ok", string, string, string] | ["none"];
type LockResult = "rotated" | "all_exhausted";

async function acquireSlot(
  redis: Redis,
  scripts: LoadedScripts
): Promise<SlotInfo | null> {
  console.log(`[balancer] Acquiring slot... totalKeys: ${KEY_IDS.length}, totalModels: ${MODELS.length}`);
  
  const raw = (await redis.evalsha(
    scripts.acquireSlotSha,
    1,
    PREFIX,
    JSON.stringify(KEY_IDS),
    JSON.stringify(MODELS),
    String(config.roundsPerModel),
    String(KEY_IDS.length)
  )) as AcquireRaw;

  if (raw[0] !== "ok") {
    console.log(`[balancer] No slot available - all keys locked`);
    return null;
  }

  const slot = {
    keyId: raw[1],
    model: raw[2] as Model,
    modelIndex: parseInt(raw[3], 10),
  };
  
  console.log(`[balancer] Slot acquired: keyId=${slot.keyId}, model=${slot.model}, modelIndex=${slot.modelIndex}`);
  return slot;
}

async function acquireSlotForModel(
  redis: Redis,
  targetModel: Model
): Promise<SlotInfo | null> {
  const targetModelIndex = MODELS.indexOf(targetModel);
  if (targetModelIndex === -1) return null;

  for (const keyId of KEY_IDS) {
    const lockK = `${PREFIX}:key:${keyId}:lock`;
    const failedK = `${PREFIX}:key:${keyId}:m${targetModelIndex}:failed`;

    const pipelineResult = await redis.pipeline()
      .exists(lockK)
      .get(failedK)
      .exec();

    if (!pipelineResult) continue;
    const isLocked = pipelineResult[0][1] as number;
    const isFailed = pipelineResult[1][1] as string | null;

    if (isLocked !== 1 && isFailed !== "1") {
      const roundsK = `${PREFIX}:key:${keyId}:m${targetModelIndex}:rounds`;
      const used = parseInt((await redis.get(roundsK)) ?? "0", 10);

      if (used < config.roundsPerModel) {
        await redis.incr(roundsK);
        return {
          keyId,
          model: targetModel,
          modelIndex: targetModelIndex,
        };
      }
    }
  }
  return null;
}

async function markFailure(
  redis: Redis,
  scripts: LoadedScripts,
  keyId: string,
  modelIndex: number
): Promise<LockResult> {
  const modelName = MODELS[modelIndex];
  console.log(`[balancer] Marking failure: keyId=${keyId}, modelIndex=${modelIndex}, model=${modelName}, ttl=${config.keyLockTtl}s`);
  
  const result = await redis.evalsha(
    scripts.lockKeySha,
    1,
    PREFIX,
    keyId,
    String(modelIndex),
    String(MODELS.length),
    String(config.keyLockTtl)
  );
  
  const lockResult = result as LockResult;
  console.log(`[balancer] Failure result: ${lockResult} for keyId=${keyId}, modelIndex=${modelIndex}`);
  return lockResult;
}

function buildError(
  axiosErr: AxiosError,
  status: number
): Error & { status: number; upstream?: unknown } {
  const msg = axiosErr.response
    ? `Upstream ${status}: ${JSON.stringify(axiosErr.response.data)}`
    : axiosErr.message;
  const err = new Error(msg) as Error & { status: number; upstream?: unknown };
  err.status = status || 502;
  err.upstream = axiosErr.response?.data;
  return err;
}

function prepareMessages(messages: ChatMessage[], returnJson: boolean): ChatMessage[] {
  if (!returnJson) return messages;

  const hasSystem = messages.length > 0 && messages[0].role === "system";

  if (hasSystem) {
    return [
      {
        role: "system",
        content: `${messages[0].content}\n\n${DEFAULT_JSON_SYSTEM_PROMPT}`,
      },
      ...messages.slice(1),
    ];
  }

  return [
    { role: "system", content: DEFAULT_JSON_SYSTEM_PROMPT },
    ...messages,
  ];
}

function attachJsonContent(responseData: Record<string, unknown>, returnJson: boolean): void {
  if (!returnJson) return;

  try {
    const choices = responseData.choices as Array<Record<string, unknown>>;
    if (!Array.isArray(choices) || choices.length === 0) return;

    const message = choices[0].message as Record<string, unknown> | undefined;
    const content = message?.content as string | undefined;
    if (!content) return;

    responseData.json_content = extractJsonBlocks(content);
  } catch (e) {
    responseData.error = String(e);
  }
}

export async function callAi(
  redis: Redis,
  scripts: LoadedScripts,
  body: CompletionRequest
): Promise<unknown> {
  const totalUniqueSlots = MODELS.length * KEY_IDS.length;
  const tried = new Set<string>();
  const hardCap = totalUniqueSlots * 2 + 2;
  let loops = 0;

  const targetModel = body.model;
  if (targetModel && !MODELS.includes(targetModel)) {
    const err = new Error(`Invalid model: ${targetModel}`) as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const maxTriesForTargetModel = targetModel ? KEY_IDS.length : totalUniqueSlots;

  console.log(`[balancer] Starting callAi: totalSlots=${totalUniqueSlots}, hardCap=${hardCap}, targetModel=${targetModel ?? "any"}`);
  console.log(`[balancer] Request body: messages=${body.messages.length}, stream=${body.stream ?? DEFAULTS.stream}`);

  while (tried.size < maxTriesForTargetModel && loops < hardCap) {
    loops++;
    console.log(`[balancer] Loop ${loops}/${hardCap}, tried combos: ${tried.size}/${maxTriesForTargetModel}`);

    const slot = targetModel
      ? await acquireSlotForModel(redis, targetModel)
      : await acquireSlot(redis, scripts);

    if (!slot) {
      console.log(`[balancer] No slot available - all keys locked`);
      const err = new Error("All API keys are locked") as Error & { code: string };
      err.code = "ELOCKED";
      throw err;
    }

    const comboKey = `${slot.keyId}:${slot.modelIndex}`;
    if (tried.has(comboKey)) {
      console.log(`[balancer] Skipping already tried combo: ${comboKey}`);
      continue;
    }
    tried.add(comboKey);
    console.log(`[balancer] Trying combo: ${comboKey} (tried: ${Array.from(tried).join(', ')})`);

    const messages = prepareMessages(body.messages, body.return_json ?? false);

    const payload = {
      messages,
      model: slot.model,
      max_tokens: body.max_tokens ?? DEFAULTS.max_tokens,
      temperature: body.temperature ?? DEFAULTS.temperature,
      top_p: body.top_p ?? DEFAULTS.top_p,
      stream: body.stream ?? DEFAULTS.stream,
    };

    console.log(`[balancer] Making API call with keyId=${slot.keyId}, model=${slot.model}`);

    try {
      const response = await axios.post(
        `${API_BASE_URL}${API_CHAT_PATH}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${KEY_MAP[slot.keyId]}`,
            "Content-Type": "application/json",
          },
          timeout: config.requestTimeoutMs,
        }
      );

      console.log(`[balancer] API call successful: status=${response.status}, keyId=${slot.keyId}, model=${slot.model}`);
      const responseData = response.data as Record<string, unknown>;
      if (typeof responseData === "object" && responseData !== null) {
        responseData.model = slot.model;
        attachJsonContent(responseData, body.return_json ?? false);
      }
      return responseData;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status ?? 0;
      console.log(`[balancer] API call failed: status=${status}, keyId=${slot.keyId}, model=${slot.model}`);

      if (status >= 400) {
        console.log(`[balancer] Marking failure and retrying...`);
        await markFailure(
          redis,
          scripts,
          slot.keyId,
          slot.modelIndex
        );
        continue;
      }

      console.log(`[balancer] Non-retryable error, throwing...`);
      throw buildError(axiosErr, status);
    }
  }

  console.log(`[balancer] Exhausted all combos after ${loops} loops`);
  const err = new Error("All API keys are locked") as Error & { code: string };
  err.code = "ELOCKED";
  throw err;
}
