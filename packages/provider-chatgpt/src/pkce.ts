import { randomBytes, createHash } from "node:crypto";

export function createState(): string {
  return randomBytes(16).toString("hex");
}

export function createCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function createCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
