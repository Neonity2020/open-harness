import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";
import { Agent, Session } from "@openharness/core";
import { readFile, listFiles, grep } from "@openharness/core/tools/fs";
import { bash } from "@openharness/core/tools/bash";

// ── Announce tool ──────────────────────────────────────────────────

const announce = tool({
  description:
    "Narrate what you are currently doing or about to do. " +
    "Use this to keep the user informed of your progress. " +
    "The message will be displayed prominently in the chat.",
  inputSchema: z.object({
    message: z.string().describe("A short status message describing what you are doing"),
  }),
  execute: async ({ message }) => message,
});

// ── Agent setup ─────────────────────────────────────────────────────

const explore = new Agent({
  name: "explore",
  description: "Read-only codebase exploration. Searches, reads files, and understands code.",
  systemPrompt:
    "You are a codebase exploration agent with read-only filesystem access. " +
    "Be concise but thorough in your findings.",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep },
  maxSteps: 15,
  instructions: false,
});

const agent = new Agent({
  name: "assistant",
  systemPrompt:
    "You are a helpful coding assistant. You can read, write, and modify files, " +
    "run shell commands, and explore the codebase using the explore subagent. " +
    "Be concise and direct in your responses.\n\n" +
    "IMPORTANT: Use the `announce` tool frequently to narrate what you are doing. " +
    "Call it before starting a multi-step task, when switching between subtasks, " +
    "and when you have a notable finding. Keep announcements short (one sentence).",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep, bash, announce },
  maxSteps: 100,
  subagents: [explore],
  instructions: false,
});

// ── Session store (in-memory, per-conversation) ─────────────────────

const sessions = new Map<string, Session>();

function getOrCreateSession(conversationId?: string): Session {
  const id = conversationId ?? crypto.randomUUID();
  let session = sessions.get(id);
  if (!session) {
    session = new Session({
      agent,
      sessionId: id,
      contextWindow: 128_000,
    });
    sessions.set(id, session);
  }
  return session;
}

// ── Route handler ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const { id, messages } = await req.json();
  const session = getOrCreateSession(id);

  // Extract the last user message text from the AI SDK 5 messages array
  // UIMessage uses `parts` (not `content`)
  const lastMessage = messages[messages.length - 1];
  const text = lastMessage.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("");

  return session.toResponse(text);
}
