export const CHATGPT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const CHATGPT_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CHATGPT_DEVICE_USER_CODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
export const CHATGPT_DEVICE_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";
export const CHATGPT_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
export const CHATGPT_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
export const DEFAULT_CHATGPT_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CHATGPT_OAUTH_SCOPE = "openid profile email offline_access";

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
export const CHATGPT_DUMMY_API_KEY = "chatgpt-oauth";
export const CHATGPT_ACCOUNT_JWT_CLAIM = "https://api.openai.com/auth";

export const OPENAI_RESPONSES_PATH = "/responses";
export const CHATGPT_CODEX_RESPONSES_PATH = "/codex/responses";

export const DEFAULT_REFRESH_SKEW_MS = 60_000;
export const DEFAULT_LOCAL_CALLBACK_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_DEVICE_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;
