import { describe, expect, it } from "vitest";
import { normalizeChatGPTModel, transformChatGPTResponsesBody } from "../transform.js";

describe("request transform", () => {
  it("normalizes model names", () => {
    expect(normalizeChatGPTModel("gpt-5.5")).toBe("gpt-5.5");
    expect(normalizeChatGPTModel("openai/gpt-5-codex")).toBe("gpt-5.1-codex");
    expect(normalizeChatGPTModel("GPT 5.2 Codex High")).toBe("gpt-5.2-codex");
    expect(normalizeChatGPTModel("gpt-5.1-codex-mini")).toBe("gpt-5.1-codex-mini");
  });

  it("transforms Responses API bodies for the Codex backend", async () => {
    const body = await transformChatGPTResponsesBody(
      {
        model: "openai/gpt-5-codex",
        instructions: "Project instructions",
        input: [
          { id: "msg_1", type: "message", role: "user", content: "hello" },
          { id: "ref_1", type: "item_reference" },
        ],
        include: ["file_search_call.results"],
        max_output_tokens: 100,
        previous_response_id: "resp_1",
      },
      {
        codexInstructions: "Codex instructions",
        reasoningEffort: "high",
      },
    );

    expect(body.model).toBe("gpt-5.1-codex");
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.instructions).toBe("Codex instructions\n\nProject instructions");
    expect(body.input).toEqual([{ type: "message", role: "user", content: "hello" }]);
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.text).toEqual({ verbosity: "medium" });
    expect(body.include).toEqual(["file_search_call.results", "reasoning.encrypted_content"]);
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
  });

  it("preserves existing reasoning and text settings unless options override them", async () => {
    const body = await transformChatGPTResponsesBody({
      model: "gpt-5.2",
      reasoning: { effort: "low", summary: "concise" },
      text: { verbosity: "high" },
    });

    expect(body.reasoning).toEqual({ effort: "low", summary: "concise" });
    expect(body.text).toEqual({ verbosity: "high" });
  });

  it("normalizes unsupported reasoning efforts for Codex models", async () => {
    const body = await transformChatGPTResponsesBody({
      model: "gpt-5.1-codex",
      reasoning: { effort: "minimal" },
    });

    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
  });
});
