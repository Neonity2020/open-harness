import { describe, expect, it, vi } from "vitest";
import { createChatGPTAuth, parseAuthorizationCallback } from "../auth.js";
import { MemoryTokenStore } from "../token-store.js";

describe("ChatGPTOAuth", () => {
  it("creates a Codex OAuth authorization URL", async () => {
    const auth = createChatGPTAuth({ tokenStore: new MemoryTokenStore() });
    const flow = await auth.createAuthorizationFlow({
      state: "test-state",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    const url = new URL(flow.authorizationUrl);

    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("test-state");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(flow.codeVerifier).toHaveLength(43);
  });

  it("exchanges authorization codes and stores tokens", async () => {
    const store = new MemoryTokenStore();
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) =>
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      }),
    );
    const auth = createChatGPTAuth({ tokenStore: store, fetch: fetchMock as typeof fetch });

    const tokens = await auth.exchangeCode({
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "http://localhost:1455/auth/callback",
      state: "state",
      expectedState: "state",
    });

    const body = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
    expect(fetchMock.mock.calls[0]![0]).toBe("https://auth.openai.com/oauth/token");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(tokens.accessToken).toBe("access");
    expect(tokens.refreshToken).toBe("refresh");
    expect(await store.get()).toEqual(tokens);
  });

  it("refreshes expired tokens", async () => {
    const store = new MemoryTokenStore({
      type: "oauth",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1,
    });
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) =>
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );
    const auth = createChatGPTAuth({ tokenStore: store, fetch: fetchMock as typeof fetch });

    const tokens = await auth.getFreshToken();

    const body = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(tokens.accessToken).toBe("new-access");
    expect((await store.get())?.refreshToken).toBe("new-refresh");
  });

  it("parses callback URLs, query strings, and pasted codes", () => {
    expect(parseAuthorizationCallback("http://localhost:1455/auth/callback?code=a&state=b")).toEqual({
      code: "a",
      state: "b",
      error: undefined,
    });
    expect(parseAuthorizationCallback("code=a&state=b")).toEqual({
      code: "a",
      state: "b",
      error: undefined,
    });
    expect(parseAuthorizationCallback("a#b")).toEqual({ code: "a", state: "b" });
    expect(parseAuthorizationCallback("a")).toEqual({ code: "a" });
  });
});
