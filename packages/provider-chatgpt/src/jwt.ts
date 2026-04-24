import { CHATGPT_ACCOUNT_JWT_CLAIM } from "./constants.js";
import type { JsonObject } from "./types.js";

export function decodeJwtPayload(token: string): JsonObject {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("Invalid JWT access token.");
  }

  try {
    return JSON.parse(base64UrlDecode(parts[1])) as JsonObject;
  } catch (error) {
    throw new Error("Unable to decode JWT access token.", { cause: error });
  }
}

export function extractChatGPTAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload[CHATGPT_ACCOUNT_JWT_CLAIM];

  if (isObject(authClaim)) {
    const accountId = authClaim.chatgpt_account_id ?? authClaim.account_id;
    if (typeof accountId === "string" && accountId.length > 0) {
      return accountId;
    }
  }

  throw new Error(
    `JWT access token does not contain ${CHATGPT_ACCOUNT_JWT_CLAIM}.chatgpt_account_id.`,
  );
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
