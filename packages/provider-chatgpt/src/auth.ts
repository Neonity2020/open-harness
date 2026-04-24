import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_CODEX_CLIENT_ID,
  CHATGPT_DEVICE_REDIRECT_URI,
  CHATGPT_DEVICE_TOKEN_URL,
  CHATGPT_DEVICE_USER_CODE_URL,
  CHATGPT_DEVICE_VERIFICATION_URL,
  CHATGPT_OAUTH_SCOPE,
  CHATGPT_TOKEN_URL,
  DEFAULT_CHATGPT_REDIRECT_URI,
  DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
  DEFAULT_DEVICE_TIMEOUT_MS,
  DEFAULT_LOCAL_CALLBACK_TIMEOUT_MS,
  DEFAULT_REFRESH_SKEW_MS,
} from "./constants.js";
import { extractChatGPTAccountId } from "./jwt.js";
import { createCodeChallenge, createCodeVerifier, createState } from "./pkce.js";
import { FileTokenStore } from "./token-store.js";
import type {
  AuthorizationFlow,
  ChatGPTOAuthOptions,
  ChatGPTTokenSet,
  CreateAuthorizationFlowOptions,
  DeviceFlow,
  DevicePollOptions,
  ExchangeAuthorizationCodeOptions,
  LocalCallbackLoginOptions,
  LocalCallbackLoginResult,
  ParsedAuthorizationCallback,
  ChatGPTTokenStore,
} from "./types.js";

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface DeviceUserCodeResponse {
  device_auth_id?: string;
  user_code?: string;
  usercode?: string;
  interval?: string | number;
}

interface DeviceAuthorizationResponse {
  authorization_code?: string;
  code_verifier?: string;
}

export class ChatGPTOAuth {
  readonly tokenStore: ChatGPTTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly clientId: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly scope: string;
  private readonly redirectUri: string;
  private readonly refreshSkewMs: number;

  constructor(options: ChatGPTOAuthOptions = {}) {
    this.tokenStore = options.tokenStore ?? new FileTokenStore();
    this.fetchImpl = options.fetch ?? getGlobalFetch();
    this.clientId = options.clientId ?? CHATGPT_CODEX_CLIENT_ID;
    this.authorizeUrl = options.authorizeUrl ?? CHATGPT_AUTHORIZE_URL;
    this.tokenUrl = options.tokenUrl ?? CHATGPT_TOKEN_URL;
    this.scope = options.scope ?? CHATGPT_OAUTH_SCOPE;
    this.redirectUri = options.redirectUri ?? DEFAULT_CHATGPT_REDIRECT_URI;
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  async createAuthorizationFlow(
    options: CreateAuthorizationFlowOptions = {},
  ): Promise<AuthorizationFlow> {
    const codeVerifier = createCodeVerifier();
    const state = options.state ?? createState();
    const redirectUri = options.redirectUri ?? this.redirectUri;
    const url = new URL(this.authorizeUrl);

    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", this.scope);
    url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", "codex_cli_rs");

    return {
      authorizationUrl: url.toString(),
      codeVerifier,
      state,
      redirectUri,
    };
  }

  async exchangeCode(options: ExchangeAuthorizationCodeOptions): Promise<ChatGPTTokenSet> {
    if (options.expectedState && options.state !== options.expectedState) {
      throw new Error("OAuth callback state did not match the authorization flow state.");
    }

    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        code: options.code,
        code_verifier: options.codeVerifier,
        redirect_uri: options.redirectUri ?? this.redirectUri,
      }),
    });

    const tokens = await this.readTokenResponse(response);
    await this.tokenStore.set(tokens);
    return tokens;
  }

  async refresh(tokens?: ChatGPTTokenSet): Promise<ChatGPTTokenSet> {
    const current = tokens ?? (await this.tokenStore.get());
    if (!current) {
      throw new Error("No ChatGPT OAuth tokens are available to refresh.");
    }

    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: this.clientId,
      }),
    });

    const refreshed = await this.readTokenResponse(response, current.refreshToken);
    await this.tokenStore.set(refreshed);
    return refreshed;
  }

  async getToken(): Promise<ChatGPTTokenSet | null> {
    return this.tokenStore.get();
  }

  async getFreshToken(): Promise<ChatGPTTokenSet> {
    const tokens = await this.tokenStore.get();
    if (!tokens) {
      throw new Error("No ChatGPT OAuth tokens found. Run a login flow before using the model.");
    }

    if (tokens.expiresAt - this.refreshSkewMs <= Date.now()) {
      return this.refresh(tokens);
    }

    return tokens;
  }

  async getAccountId(tokens?: ChatGPTTokenSet): Promise<string> {
    const current = tokens ?? (await this.getFreshToken());
    return extractChatGPTAccountId(current.accessToken);
  }

  async clear(): Promise<void> {
    await this.tokenStore.clear();
  }

  async loginWithLocalCallback(
    options: LocalCallbackLoginOptions = {},
  ): Promise<LocalCallbackLoginResult> {
    const hostname = options.hostname ?? "127.0.0.1";
    const path = options.path ?? "/auth/callback";
    const requestedPort = options.port ?? 1455;
    if (requestedPort === 0) {
      throw new Error("ChatGPT local callback login requires a fixed OAuth redirect port.");
    }
    const serverOrigin = `http://${hostname}:${requestedPort}`;
    const redirectUri = `${serverOrigin}${path}`;
    const flow = await this.createAuthorizationFlow({ redirectUri });

    return new Promise<LocalCallbackLoginResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(new Error("Timed out waiting for the ChatGPT OAuth callback."));
      }, options.timeoutMs ?? DEFAULT_LOCAL_CALLBACK_TIMEOUT_MS);

      const server = createServer(async (request, response) => {
        const requestUrl = new URL(request.url ?? "/", serverOrigin);

        if (requestUrl.pathname !== path) {
          response.writeHead(404).end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          response.writeHead(400).end("Authentication failed.");
          finish(new Error(`ChatGPT OAuth failed: ${error}`));
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state") ?? undefined;

        if (!code) {
          response.writeHead(400).end("Missing authorization code.");
          finish(new Error("OAuth callback did not include an authorization code."));
          return;
        }

        try {
          const tokens = await this.exchangeCode({
            code,
            state,
            expectedState: flow.state,
            codeVerifier: flow.codeVerifier,
            redirectUri: flow.redirectUri,
          });
          response
            .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            .end(options.successHtml ?? defaultSuccessHtml());
          finish(null, {
            tokens,
            flow,
            callbackUrl: requestUrl.toString(),
          });
        } catch (error) {
          response.writeHead(500).end("Token exchange failed.");
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });

      server.once("error", (error) => finish(error));
      server.listen(requestedPort, hostname, async () => {
        try {
          if (options.openBrowser !== false) {
            await (options.open ?? openUrl)(flow.authorizationUrl);
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });

      function finish(error: Error | null, result?: LocalCallbackLoginResult): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        if (error) {
          reject(error);
        } else {
          resolve(result!);
        }
      }
    });
  }

  async startDeviceFlow(): Promise<DeviceFlow> {
    const response = await this.fetchImpl(CHATGPT_DEVICE_USER_CODE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id: this.clientId }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to start ChatGPT device auth: ${response.status} ${await readResponseText(response)}`,
      );
    }

    const data = (await response.json()) as DeviceUserCodeResponse;
    const userCode = data.user_code ?? data.usercode;
    const deviceAuthId = data.device_auth_id;
    const intervalSeconds = normalizeInterval(data.interval);

    if (!userCode || !deviceAuthId) {
      throw new Error("ChatGPT device auth response did not include a user code.");
    }

    return {
      verificationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
      userCode,
      intervalSeconds,
      expiresAt: Date.now() + DEFAULT_DEVICE_TIMEOUT_MS,
      pollUntilComplete: (options?: DevicePollOptions) =>
        this.pollDeviceFlow(deviceAuthId, userCode, intervalSeconds, options),
    };
  }

  private async pollDeviceFlow(
    deviceAuthId: string,
    userCode: string,
    intervalSeconds: number,
    options: DevicePollOptions = {},
  ): Promise<ChatGPTTokenSet> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(intervalSeconds * 1000, options.signal);
      options.onPoll?.();

      const response = await this.fetchImpl(CHATGPT_DEVICE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          device_auth_id: deviceAuthId,
          user_code: userCode,
        }),
        signal: options.signal,
      });

      if (response.status === 403 || response.status === 404) {
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `ChatGPT device auth polling failed: ${response.status} ${await readResponseText(
            response,
          )}`,
        );
      }

      const data = (await response.json()) as DeviceAuthorizationResponse;
      if (!data.authorization_code || !data.code_verifier) {
        throw new Error("ChatGPT device auth response did not include an authorization code.");
      }

      return this.exchangeCode({
        code: data.authorization_code,
        codeVerifier: data.code_verifier,
        redirectUri: CHATGPT_DEVICE_REDIRECT_URI,
      });
    }

    throw new Error("Timed out waiting for ChatGPT device authorization.");
  }

  private async readTokenResponse(
    response: Response,
    fallbackRefreshToken?: string,
  ): Promise<ChatGPTTokenSet> {
    if (!response.ok) {
      throw new Error(
        `ChatGPT OAuth token request failed: ${response.status} ${await readResponseText(response)}`,
      );
    }

    const json = (await response.json()) as OAuthTokenResponse;
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw new Error("ChatGPT OAuth token response did not include an access token and expiry.");
    }

    const refreshToken = json.refresh_token ?? fallbackRefreshToken;
    if (!refreshToken) {
      throw new Error("ChatGPT OAuth token response did not include a refresh token.");
    }

    return {
      type: "oauth",
      accessToken: json.access_token,
      refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
  }
}

export function createChatGPTAuth(options?: ChatGPTOAuthOptions): ChatGPTOAuth {
  return new ChatGPTOAuth(options);
}

export function parseAuthorizationCallback(input: string): ParsedAuthorizationCallback {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
    };
  } catch {
    // Continue with query-string or code#state parsing.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  if (value.includes("=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
      error: params.get("error") ?? undefined,
    };
  }

  return { code: value };
}

function getGlobalFetch(): typeof fetch {
  if (!globalThis.fetch) {
    throw new Error("A fetch implementation is required to use ChatGPT OAuth.");
  }
  return globalThis.fetch.bind(globalThis);
}

async function readResponseText(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

function normalizeInterval(interval: string | number | undefined): number {
  if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) {
    return interval;
  }
  if (typeof interval === "string") {
    const parsed = Number.parseInt(interval, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DEVICE_POLL_INTERVAL_SECONDS;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function defaultSuccessHtml(): string {
  return `<!doctype html><html><body><h1>Signed in</h1><p>You can close this window.</p></body></html>`;
}
