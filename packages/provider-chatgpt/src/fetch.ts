import {
  CHATGPT_CODEX_RESPONSES_PATH,
  OPENAI_RESPONSES_PATH,
} from "./constants.js";
import { convertEventStreamToJsonResponse, ensureEventStreamContentType } from "./response.js";
import { transformChatGPTResponsesBody } from "./transform.js";
import type {
  ChatGPTAuthLike,
  ChatGPTProviderOptions,
  ChatGPTRequestTransformOptions,
  JsonObject,
} from "./types.js";

export interface ChatGPTCodexFetchOptions {
  auth: ChatGPTAuthLike;
  fetch?: typeof fetch;
  promptCacheKey?: ChatGPTProviderOptions["promptCacheKey"];
  transform?: ChatGPTRequestTransformOptions;
}

export function createChatGPTCodexFetch(options: ChatGPTCodexFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? getGlobalFetch();

  return async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = extractRequestUrl(input);
    if (!isResponsesUrl(url)) {
      return baseFetch(input, init);
    }

    const requestInit = normalizeRequestInit(input, init);
    const body = await readJsonBody(requestInit.body);
    const wasStreaming = body.stream === true;
    const transformedBody = await transformChatGPTResponsesBody(body, options.transform);
    const tokens = await options.auth.getFreshToken();
    const accountId = await options.auth.getAccountId(tokens);
    const promptCacheKey = await resolvePromptCacheKey(options.promptCacheKey);

    const response = await baseFetch(rewriteUrlForCodex(url), {
      ...requestInit,
      body: JSON.stringify(transformedBody),
      headers: createCodexHeaders(requestInit.headers, tokens.accessToken, accountId, promptCacheKey),
    });

    if (!response.ok) return response;
    if (wasStreaming) return ensureEventStreamContentType(response);
    return convertEventStreamToJsonResponse(response);
  };
}

export function rewriteUrlForCodex(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith(OPENAI_RESPONSES_PATH)) {
    parsed.pathname =
      parsed.pathname.slice(0, -OPENAI_RESPONSES_PATH.length) + CHATGPT_CODEX_RESPONSES_PATH;
  }
  return parsed.toString();
}

export function createCodexHeaders(
  sourceHeaders: HeadersInit | undefined,
  accessToken: string,
  accountId: string,
  promptCacheKey?: string,
): Headers {
  const headers = new Headers(sourceHeaders);
  headers.delete("x-api-key");
  headers.delete("content-length");
  headers.delete("OpenAI-Organization");
  headers.delete("OpenAI-Project");
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", "codex_cli_rs");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");

  if (promptCacheKey) {
    headers.set("conversation_id", promptCacheKey);
    headers.set("session_id", promptCacheKey);
  } else {
    headers.delete("conversation_id");
    headers.delete("session_id");
  }

  return headers;
}

function extractRequestUrl(input: URL | RequestInfo): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isResponsesUrl(url: string): boolean {
  return new URL(url).pathname.endsWith(OPENAI_RESPONSES_PATH);
}

function normalizeRequestInit(input: URL | RequestInfo, init?: RequestInit): RequestInit {
  if (init) return { ...init };
  if (input instanceof Request) {
    return {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: input.signal,
    };
  }
  return {};
}

async function readJsonBody(body: BodyInit | null | undefined): Promise<JsonObject> {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body) as JsonObject;
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (body instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(body)) as JsonObject;
  }
  if (ArrayBuffer.isView(body)) {
    return JSON.parse(new TextDecoder().decode(body)) as JsonObject;
  }

  const text = await new Response(body).text();
  return JSON.parse(text) as JsonObject;
}

async function resolvePromptCacheKey(
  promptCacheKey: ChatGPTProviderOptions["promptCacheKey"],
): Promise<string | undefined> {
  if (typeof promptCacheKey === "function") return promptCacheKey();
  return promptCacheKey;
}

function getGlobalFetch(): typeof fetch {
  if (!globalThis.fetch) {
    throw new Error("A fetch implementation is required to use the ChatGPT provider.");
  }
  return globalThis.fetch.bind(globalThis);
}
