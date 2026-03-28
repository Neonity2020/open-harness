import { describe, it, expect } from "vitest";
import { NodeShellProvider } from "../../providers/node.js";
import { createBashTool } from "../../tools/create-bash-tool.js";

describe("createBashTool", () => {
  it("executes commands via the shell provider", async () => {
    const provider = new NodeShellProvider();
    const { bash } = createBashTool(provider);
    const result = await bash.execute(
      { command: "echo hello", timeout: 30000 },
      { toolCallId: "test", messages: [] },
    );
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("works with a custom shell provider", async () => {
    const mockShell = {
      exec: async () => ({ stdout: "mocked", stderr: "", exitCode: 0 }),
    };
    const { bash } = createBashTool(mockShell);
    const result = await bash.execute(
      { command: "anything", timeout: 30000 },
      { toolCallId: "test", messages: [] },
    );
    expect(result.stdout).toBe("mocked");
  });
});
