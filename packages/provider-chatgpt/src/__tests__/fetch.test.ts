import { describe, expect, it, vi } from "vitest";
import { createChatGPTCodexFetch, rewriteUrlForCodex } from "../fetch.js";

describe("ChatGPT Codex fetch", () => {
  it("rewrites Responses API URLs", () => {
    expect(rewriteUrlForCodex("https://chatgpt.com/backend-api/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
  });

  it("injects OAuth headers and converts non-streaming SSE responses to JSON", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(
        `data: ${JSON.stringify({
          type: "response.done",
          response: { id: "resp_1", output: [], usage: {} },
        })}\n\n`,
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    });
    const fetcher = createChatGPTCodexFetch({
      fetch: fetchMock as typeof fetch,
      auth: {
        async getFreshToken() {
          return {
            type: "oauth",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() + 60_000,
          };
        },
        async getAccountId() {
          return "account-id";
        },
      },
      transform: {
        codexInstructions: false,
      },
    });

    const response = await fetcher("https://chatgpt.com/backend-api/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer dummy",
        "x-api-key": "dummy",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-codex",
        input: [],
      }),
    });

    const headers = requestInit!.headers as Headers;
    const body = JSON.parse(requestInit!.body as string) as Record<string, unknown>;
    expect(requestUrl).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("chatgpt-account-id")).toBe("account-id");
    expect(headers.get("OpenAI-Beta")).toBe("responses=experimental");
    expect(headers.has("x-api-key")).toBe(false);
    expect(body.model).toBe("gpt-5.1-codex");
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ id: "resp_1", output: [], usage: {} });
  });

  it("passes streaming SSE responses through", async () => {
    const fetcher = createChatGPTCodexFetch({
      fetch: (async () =>
        new Response("data: {}\n\n", {
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
      auth: {
        async getFreshToken() {
          return {
            type: "oauth",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() + 60_000,
          };
        },
        async getAccountId() {
          return "account-id";
        },
      },
      transform: {
        codexInstructions: false,
      },
    });

    const response = await fetcher("https://chatgpt.com/backend-api/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.2-codex",
        stream: true,
      }),
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe("data: {}\n\n");
  });
});
