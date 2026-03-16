import { convertToModelMessages, type UIMessage, type ModelMessage } from "ai";

/**
 * Extract user input from an AI SDK 5 UIMessage array, ready to pass
 * to `session.send()` or `session.toResponse()`.
 *
 * - Text-only → returns `string` (fast path, preserves existing behavior)
 * - Has files  → returns `ModelMessage[]` via AI SDK's `convertToModelMessages()`
 */
export async function extractUserInput(
  messages: UIMessage[],
): Promise<string | ModelMessage[]> {
  if (messages.length === 0) {
    throw new Error("extractUserInput: messages array is empty");
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    throw new Error(
      `extractUserInput: last message has role "${lastMessage.role}", expected "user"`,
    );
  }

  const hasFiles = lastMessage.parts.some((p) => p.type === "file");

  if (!hasFiles) {
    // Text-only fast path
    return lastMessage.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  // Has files — convert the full last user message via AI SDK
  const modelMessages = await convertToModelMessages([lastMessage]);
  return modelMessages;
}
