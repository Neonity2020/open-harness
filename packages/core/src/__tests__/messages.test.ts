import { describe, it, expect } from "vitest";
import { extractUserInput } from "../messages.js";
import type { UIMessage } from "ai";

function makeTextMessage(text: string, role: "user" | "assistant" = "user"): UIMessage {
  return {
    id: "msg-1",
    role,
    parts: [{ type: "text", text }],
  };
}

function makeFileMessage(
  mediaType: string,
  url: string,
  filename?: string,
  text?: string,
): UIMessage {
  const parts: UIMessage["parts"] = [];
  if (text) {
    parts.push({ type: "text", text });
  }
  parts.push({ type: "file", mediaType, url, filename });
  return {
    id: "msg-2",
    role: "user",
    parts,
  };
}

describe("extractUserInput", () => {
  it("returns string for text-only message", async () => {
    const result = await extractUserInput([makeTextMessage("hello world")]);
    expect(result).toBe("hello world");
  });

  it("concatenates multiple text parts", async () => {
    const msg: UIMessage = {
      id: "msg-1",
      role: "user",
      parts: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
      };
    const result = await extractUserInput([msg]);
    expect(result).toBe("hello world");
  });

  it("returns ModelMessage[] for message with file", async () => {
    const msg = makeFileMessage(
      "image/png",
      "data:image/png;base64,iVBOR",
      "test.png",
      "describe this image",
    );
    const result = await extractUserInput([msg]);
    expect(Array.isArray(result)).toBe(true);
    const messages = result as any[];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe("user");
  });

  it("returns ModelMessage[] for file-only (no text)", async () => {
    const msg = makeFileMessage("image/jpeg", "data:image/jpeg;base64,/9j/4A");
    const result = await extractUserInput([msg]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("uses only the last message", async () => {
    const result = await extractUserInput([
      makeTextMessage("first message"),
      makeTextMessage("second message"),
    ]);
    expect(result).toBe("second message");
  });

  it("throws on empty array", async () => {
    await expect(extractUserInput([])).rejects.toThrow("messages array is empty");
  });

  it("throws when last message is not from user", async () => {
    await expect(
      extractUserInput([makeTextMessage("hi", "assistant")]),
    ).rejects.toThrow('expected "user"');
  });
});
