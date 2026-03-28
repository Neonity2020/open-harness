import * as readline from "node:readline";
import { openai } from "@ai-sdk/openai";
import chalk from "chalk";
import ora from "ora";
import {
  Agent,
  Conversation,
  toRunner,
  apply,
  withTurnTracking,
  withCompaction,
  withRetry,
  type AgentEvent,
  type ToolCallInfo,
  type SessionEvent,
} from "@openharness/core";
import { createFsTools, createBashTool, NodeFsProvider, NodeShellProvider } from "@openharness/core";

const fsProvider = new NodeFsProvider();
const shellProvider = new NodeShellProvider();
const fsTools = createFsTools(fsProvider);
const { readFile, listFiles, grep } = fsTools;
const { bash } = createBashTool(shellProvider);

// ── Readline setup ───────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// ── Tool approval ────────────────────────────────────────────────────

// Mutex so parallel tool calls are prompted one at a time
let approvalQueue: Promise<void> = Promise.resolve();

// Spinners keyed by toolCallId — handles parallel tool executions
const spinners = new Map<string, ReturnType<typeof ora>>();

const BAR = chalk.dim("│");

function formatInput(input: unknown): string {
  const json = JSON.stringify(input, null, 2);
  return json
    .split("\n")
    .map((line) => `  ${BAR}   ${chalk.dim(line)}`)
    .join("\n");
}

function approve(toolCall: ToolCallInfo): Promise<boolean> {
  const result = approvalQueue.then(() => promptApproval(toolCall));
  approvalQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function promptApproval({ toolName, toolCallId, input }: ToolCallInfo): Promise<boolean> {
  console.log(`  ${BAR}`);
  console.log(`  ${chalk.yellow("○")} ${chalk.bold("Tool call:")} ${chalk.cyan(toolName)}`);
  console.log(formatInput(input));
  console.log(`  ${BAR}`);

  const answer = await ask(`  ${BAR} ${chalk.yellow("?")} Allow? ${chalk.dim("[Y/n]")} `);
  const denied = answer.trim().toLowerCase() === "n";

  if (denied) {
    console.log(`  ${BAR} ${chalk.red("✗")} Denied`);
    console.log(`  ${BAR}`);
    return false;
  }

  const spinner = ora({
    text: chalk.dim(toolName),
    prefixText: `  ${BAR}`,
    spinner: "dots",
  }).start();
  spinners.set(toolCallId, spinner);

  return true;
}

// ── Subagent events ──────────────────────────────────────────────────

let subStreaming = false;

function onSubagentEvent(path: string[], event: AgentEvent) {
  const depth = path.length;
  const indent = "  ".repeat(depth);
  const inner = chalk.dim("│");
  const prefix = `  ${BAR} ${indent}${inner}`;
  const label = path.join(chalk.dim(" > "));

  switch (event.type) {
    case "step.start":
      if (event.stepNumber === 1) {
        // Stop the parent task spinner to make room for subagent output
        for (const s of spinners.values()) s.stop();
        spinners.clear();
        console.log(`  ${BAR} ${indent}${chalk.dim("┌")} ${chalk.magenta(label)}`);
      }
      break;

    case "text.delta": {
      if (!subStreaming) {
        process.stdout.write(`${prefix} `);
        subStreaming = true;
      }
      // Indent any newlines within the streamed text
      process.stdout.write(event.text.replace(/\n/g, `\n${prefix} `));
      break;
    }

    case "text.done":
      if (subStreaming) {
        process.stdout.write("\n");
        subStreaming = false;
      }
      break;

    case "tool.done":
      console.log(`${prefix} ${chalk.green("✔")} ${chalk.dim(event.toolName)}`);
      break;

    case "tool.error":
      console.log(
        `${prefix} ${chalk.red("✗")} ${chalk.dim(event.toolName)} ${chalk.red(event.error)}`,
      );
      break;

    case "error":
      console.log(`${prefix} ${chalk.red("✗")} ${event.error.message}`);
      break;

    case "done":
      console.log(`  ${BAR} ${indent}${chalk.dim("└ done")}`);
      break;
  }
}

// ── Agents ───────────────────────────────────────────────────────────

const explore = new Agent({
  name: "explore",
  description:
    "Read-only codebase exploration. Use for searching, reading files, and understanding code.",
  systemPrompt:
    "You are a codebase exploration agent. You have read-only access to the filesystem. " +
    "Use your tools to thoroughly explore the codebase and answer questions. " +
    "Be concise but thorough in your findings.",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep, bash },
  maxSteps: 30,
});

const agent = new Agent({
  name: "cli-agent",
  systemPrompt:
    "You are an expert agent built with open-harness. You are invoked through a CLI tool and have access to a set of tools to help you complete tasks. " +
    "You help the user analyze, understand, make changes to, and implement features in their project. " +
    "For read-only exploration tasks (searching, reading, understanding code), prefer using the explore subagent via the task tool.",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  maxSteps: 20,
  approve,
  subagents: [explore],
  onSubagentEvent,
});

// ── Compose middleware ───────────────────────────────────────────────

const runner = apply(
  toRunner(agent),
  withTurnTracking(),
  withCompaction({ contextWindow: 200_000, model: agent.model }),
  withRetry(),
);

const chat = new Conversation({ runner });

// ── Main loop ────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(
    `  ${chalk.bold.cyan("open-harness")} ${chalk.dim("gpt-5.2 · fs tools · explore subagent")}`,
  );
  console.log(`  ${chalk.dim('Type "exit" to quit.')}`);

  while (true) {
    console.log();
    const input = await ask(`  ${chalk.green("❯")} `);
    if (input.trim().toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    console.log();

    let doneEvent: Extract<SessionEvent, { type: "done" }> | undefined;
    let streaming = false;

    for await (const event of chat.send(input)) {
      switch (event.type) {
        case "turn.start":
          break;

        case "text.delta":
          if (!streaming) {
            process.stdout.write(`  ${BAR} `);
            streaming = true;
          }
          process.stdout.write(event.text);
          break;

        case "text.done":
          if (streaming) {
            process.stdout.write("\n");
            streaming = false;
          }
          break;

        case "tool.start":
          // Display + spinner handled by the approve callback
          break;

        case "tool.done": {
          const s = spinners.get(event.toolCallId);
          if (s) {
            s.succeed(chalk.dim(event.toolName));
          } else {
            // Spinner was cleared for subagent display
            console.log(`  ${BAR} ${chalk.green("✔")} ${chalk.dim(event.toolName)}`);
          }
          spinners.delete(event.toolCallId);
          break;
        }

        case "tool.error": {
          const s = spinners.get(event.toolCallId);
          if (s) {
            s.fail(`${chalk.dim(event.toolName)} ${chalk.red(event.error)}`);
          } else {
            console.log(
              `  ${BAR} ${chalk.red("✗")} ${chalk.dim(event.toolName)} ${chalk.red(event.error)}`,
            );
          }
          spinners.delete(event.toolCallId);
          break;
        }

        case "step.done":
          break;

        case "error":
          for (const s of spinners.values()) s.stop();
          spinners.clear();
          console.error(`  ${chalk.red("✗")} ${event.error.message}`);
          break;

        case "done":
          doneEvent = event;
          break;

        case "compaction.start":
          console.log(
            `  ${chalk.dim("⟳")} Compacting... (${event.tokensBefore} estimated tokens)`,
          );
          break;

        case "compaction.done":
          console.log(
            `  ${chalk.green("✔")} Compacted: ${event.tokensBefore} → ${event.tokensAfter} estimated tokens`,
          );
          break;

        case "retry":
          console.log(
            `  ${chalk.yellow("⟳")} Retrying in ${event.delayMs}ms... (attempt ${event.attempt + 1}/${event.maxRetries})`,
          );
          break;

        case "turn.done": {
          const parts: string[] = [`Turn ${event.turnNumber}`];
          if (event.usage.totalTokens) {
            parts.push(`${event.usage.totalTokens} tokens`);
          }
          console.log(`  ${chalk.dim(parts.join(" · "))}`);
          break;
        }
      }
    }

    if (streaming) {
      process.stdout.write("\n");
    }

    if (doneEvent) {
      const { totalUsage } = doneEvent;
      const parts: string[] = [doneEvent.result];
      if (totalUsage.totalTokens) {
        parts.push(`${totalUsage.totalTokens} tokens`);
      }
      console.log(`  ${chalk.dim(parts.join(" · "))}`);
    }
  }

  console.log();
  console.log(`  ${chalk.dim("Goodbye.")}`);
  console.log();
  await agent.close();
  rl.close();
}

main();
