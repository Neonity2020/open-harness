import type { ChatGPTRequestTransformOptions, JsonObject } from "./types.js";

const DEFAULT_CODEX_INSTRUCTIONS =
  "You are Codex, an AI coding agent. Follow the user's instructions and use the provided tools when needed.";

const MODEL_MAP: Record<string, string> = {
  "gpt-5.5": "gpt-5.5",
  "gpt-5.2-codex": "gpt-5.2-codex",
  "gpt-5.2": "gpt-5.2",
  "gpt-5.1-codex-max": "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
  "gpt-5.1-codex": "gpt-5.1-codex",
  "gpt-5.1": "gpt-5.1",
  "codex-mini-latest": "codex-mini-latest",
  "gpt-5-codex": "gpt-5.1-codex",
  "gpt-5-codex-mini": "codex-mini-latest",
};

export function normalizeChatGPTModel(model: unknown): string {
  if (typeof model !== "string" || model.length === 0) return "gpt-5.1-codex";

  const modelId = model.includes("/") ? model.split("/").at(-1)! : model;
  const mapped = MODEL_MAP[modelId];
  if (mapped) return mapped;

  const normalized = modelId.toLowerCase();

  if (normalized.includes("gpt-5.5") || normalized.includes("gpt 5.5")) {
    return "gpt-5.5";
  }
  if (normalized.includes("gpt-5.2-codex") || normalized.includes("gpt 5.2 codex")) {
    return "gpt-5.2-codex";
  }
  if (normalized.includes("gpt-5.2") || normalized.includes("gpt 5.2")) {
    return "gpt-5.2";
  }
  if (normalized.includes("codex-max") || normalized.includes("codex max")) {
    return "gpt-5.1-codex-max";
  }
  if (normalized.includes("codex-mini") || normalized.includes("codex mini")) {
    return "gpt-5.1-codex-mini";
  }
  if (normalized.includes("codex")) {
    return "gpt-5.1-codex";
  }
  if (normalized.includes("gpt-5.1") || normalized.includes("gpt 5.1")) {
    return "gpt-5.1";
  }
  if (normalized.includes("gpt-5") || normalized.includes("gpt 5")) {
    return "gpt-5.1";
  }

  return modelId;
}

export async function transformChatGPTResponsesBody(
  body: JsonObject,
  options: ChatGPTRequestTransformOptions = {},
): Promise<JsonObject> {
  const transformed = cloneJsonObject(body);
  const model = normalizeChatGPTModel(transformed.model);
  const existingInstructions = typeof transformed.instructions === "string" ? transformed.instructions : undefined;
  const codexInstructions = await resolveCodexInstructions(model, options.codexInstructions);

  transformed.model = model;
  transformed.store = false;
  transformed.stream = true;

  if (codexInstructions && existingInstructions) {
    transformed.instructions = `${codexInstructions}\n\n${existingInstructions}`;
  } else if (codexInstructions) {
    transformed.instructions = codexInstructions;
  }

  if (Array.isArray(transformed.input)) {
    transformed.input = transformInput(transformed.input);
  }

  const existingReasoning = isObject(transformed.reasoning) ? transformed.reasoning : {};
  const existingText = isObject(transformed.text) ? transformed.text : {};

  transformed.reasoning = {
    ...existingReasoning,
    effort: normalizeReasoningEffort(
      options.reasoningEffort ??
        readString(existingReasoning.effort) ??
        readProviderOption(transformed, "reasoningEffort") ??
        "medium",
      model,
    ),
    summary:
      options.reasoningSummary ??
      readString(existingReasoning.summary) ??
      readProviderOption(transformed, "reasoningSummary") ??
      "auto",
  };

  transformed.text = {
    ...existingText,
    verbosity:
      options.textVerbosity ??
      readString(existingText.verbosity) ??
      readProviderOption(transformed, "textVerbosity") ??
      "medium",
  };

  transformed.include = mergeInclude(options.include, transformed.include);
  delete transformed.max_output_tokens;
  delete transformed.max_completion_tokens;
  delete transformed.previous_response_id;

  return transformed;
}

function transformInput(input: unknown[]): unknown[] {
  return input
    .filter((item) => !isObject(item) || item.type !== "item_reference")
    .map((item) => {
      if (!isObject(item) || !("id" in item)) return item;
      const { id: _id, ...withoutId } = item;
      return withoutId;
    });
}

async function resolveCodexInstructions(
  model: string,
  instructions: ChatGPTRequestTransformOptions["codexInstructions"],
): Promise<string | undefined> {
  if (instructions === false) return undefined;
  if (typeof instructions === "function") return instructions(model);
  if (typeof instructions === "string") return instructions;
  return DEFAULT_CODEX_INSTRUCTIONS;
}

function mergeInclude(configured: string[] | undefined, existing: unknown): string[] {
  const values = [
    ...(Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : []),
    ...(configured ?? []),
    "reasoning.encrypted_content",
  ];
  return Array.from(new Set(values));
}

function readProviderOption(body: JsonObject, key: string): unknown {
  const providerOptions = body.providerOptions;
  if (!isObject(providerOptions)) return undefined;
  const openaiOptions = providerOptions.openai;
  if (!isObject(openaiOptions)) return undefined;
  return openaiOptions[key];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeReasoningEffort(value: unknown, model: string): string {
  const effort = typeof value === "string" ? value : "medium";
  const isCodexMini = model.includes("codex-mini") || model === "codex-mini-latest";
  const isCodex = model.includes("codex") || model.startsWith("codex-");
  const supportsXhigh =
    model.includes("gpt-5.5") || model.includes("gpt-5.2") || model.includes("codex-max");

  if (isCodexMini) {
    if (effort === "high" || effort === "xhigh") return "high";
    return "medium";
  }

  if (effort === "minimal") return "low";
  if (effort === "none" && isCodex) return "low";
  if (effort === "xhigh" && !supportsXhigh) return "high";
  if (["none", "low", "medium", "high", "xhigh"].includes(effort)) return effort;
  return "medium";
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
