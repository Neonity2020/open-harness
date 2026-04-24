export interface ChatGPTTokenSet {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface ChatGPTTokenStore {
  get(): Promise<ChatGPTTokenSet | null>;
  set(tokens: ChatGPTTokenSet): Promise<void>;
  clear(): Promise<void>;
}

export interface AuthorizationFlow {
  authorizationUrl: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

export interface ChatGPTOAuthOptions {
  tokenStore?: ChatGPTTokenStore;
  fetch?: typeof fetch;
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scope?: string;
  redirectUri?: string;
  refreshSkewMs?: number;
}

export interface CreateAuthorizationFlowOptions {
  redirectUri?: string;
  state?: string;
}

export interface ExchangeAuthorizationCodeOptions {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
  state?: string;
  expectedState?: string;
}

export interface ParsedAuthorizationCallback {
  code?: string;
  state?: string;
  error?: string;
}

export interface LocalCallbackLoginOptions {
  hostname?: string;
  port?: number;
  path?: string;
  openBrowser?: boolean;
  open?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  successHtml?: string;
}

export interface LocalCallbackLoginResult {
  tokens: ChatGPTTokenSet;
  flow: AuthorizationFlow;
  callbackUrl: string;
}

export interface DeviceFlow {
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  intervalSeconds: number;
  pollUntilComplete(options?: DevicePollOptions): Promise<ChatGPTTokenSet>;
}

export interface DevicePollOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onPoll?: () => void;
}

export interface ChatGPTProviderOptions {
  auth?: ChatGPTAuthLike;
  tokenStore?: ChatGPTTokenStore;
  fetch?: typeof fetch;
  baseURL?: string;
  promptCacheKey?: string | (() => string | undefined | Promise<string | undefined>);
  transform?: ChatGPTRequestTransformOptions;
}

export interface ChatGPTAuthLike {
  getFreshToken(): Promise<ChatGPTTokenSet>;
  getAccountId(tokens?: ChatGPTTokenSet): Promise<string>;
}

export interface ChatGPTRequestTransformOptions {
  codexInstructions?: string | false | ((model: string) => string | Promise<string>);
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed";
  textVerbosity?: "low" | "medium" | "high";
  include?: string[];
}

export interface JsonObject {
  [key: string]: unknown;
}
