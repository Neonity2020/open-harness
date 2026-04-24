import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatGPTTokenSet, ChatGPTTokenStore } from "./types.js";

export class MemoryTokenStore implements ChatGPTTokenStore {
  private tokens: ChatGPTTokenSet | null;

  constructor(tokens?: ChatGPTTokenSet | null) {
    this.tokens = tokens ?? null;
  }

  async get(): Promise<ChatGPTTokenSet | null> {
    return this.tokens;
  }

  async set(tokens: ChatGPTTokenSet): Promise<void> {
    this.tokens = tokens;
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}

export class FileTokenStore implements ChatGPTTokenStore {
  readonly path: string;

  constructor(path: string = defaultChatGPTAuthPath()) {
    this.path = expandHome(path);
  }

  async get(): Promise<ChatGPTTokenSet | null> {
    const data = await readJsonFile(this.path);
    return normalizeTokenSet(data);
  }

  async set(tokens: ChatGPTTokenSet): Promise<void> {
    await writePrivateJsonFile(this.path, tokens);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export class OpenCodeTokenStore implements ChatGPTTokenStore {
  readonly path: string;

  constructor(path: string = defaultOpenCodeAuthPath()) {
    this.path = expandHome(path);
  }

  async get(): Promise<ChatGPTTokenSet | null> {
    const data = await readJsonFile(this.path);
    if (!isObject(data)) return null;
    return normalizeTokenSet(data.openai);
  }

  async set(tokens: ChatGPTTokenSet): Promise<void> {
    const data = await readJsonFile(this.path);
    const auth = isObject(data) ? { ...data } : {};
    auth.openai = {
      type: "oauth",
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      expires: tokens.expiresAt,
    };
    await writePrivateJsonFile(this.path, auth);
  }

  async clear(): Promise<void> {
    const data = await readJsonFile(this.path);
    if (!isObject(data) || !("openai" in data)) return;

    const auth = { ...data };
    delete auth.openai;
    await writePrivateJsonFile(this.path, auth);
  }
}

export function defaultChatGPTAuthPath(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "openharness", "chatgpt-auth.json");
}

export function defaultOpenCodeAuthPath(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "opencode", "auth.json");
}

export function normalizeTokenSet(value: unknown): ChatGPTTokenSet | null {
  if (!isObject(value) || value.type !== "oauth") return null;

  const accessToken = pickString(value, "accessToken", "access", "access_token");
  const refreshToken = pickString(value, "refreshToken", "refresh", "refresh_token");
  const expiresAt = pickNumber(value, "expiresAt", "expires", "expires_at");

  if (!accessToken || !refreshToken || !expiresAt) return null;

  return {
    type: "oauth",
    accessToken,
    refreshToken,
    expiresAt,
  };
}

function pickString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function pickNumber(source: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
