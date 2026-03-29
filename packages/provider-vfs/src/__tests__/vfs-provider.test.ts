import { describe, it, expect, beforeEach } from "vitest";
import { VfsFsProvider, FileTooLargeError } from "../vfs-provider.js";
import { MemoryProvider, create } from "@platformatic/vfs";

// ── Helpers ─────────────────────────────────────────────────────────

let provider: VfsFsProvider;

beforeEach(() => {
  const vfs = create(new MemoryProvider(), { moduleHooks: false, virtualCwd: true });
  vfs.mount("/workspace");
  provider = new VfsFsProvider({ vfs, mountPoint: "/workspace" });
});

// ── Basic read/write ────────────────────────────────────────────────

describe("readFile / writeFile", () => {
  it("writes and reads a file", async () => {
    await provider.writeFile("/workspace/hello.txt", "hello world");
    const content = await provider.readFile("/workspace/hello.txt");
    expect(content).toBe("hello world");
  });

  it("creates parent directories on write", async () => {
    await provider.writeFile("/workspace/a/b/c.txt", "nested");
    const content = await provider.readFile("/workspace/a/b/c.txt");
    expect(content).toBe("nested");
  });

  it("overwrites existing files", async () => {
    await provider.writeFile("/workspace/file.txt", "first");
    await provider.writeFile("/workspace/file.txt", "second");
    const content = await provider.readFile("/workspace/file.txt");
    expect(content).toBe("second");
  });
});

// ── Size guard ──────────────────────────────────────────────────────

describe("maxFileSize", () => {
  it("throws FileTooLargeError for oversized files", async () => {
    const vfs = create(new MemoryProvider(), { moduleHooks: false, virtualCwd: true });
    vfs.mount("/workspace");
    const small = new VfsFsProvider({ vfs, maxFileSize: 10 });

    await small.writeFile("/workspace/big.txt", "a".repeat(100));
    await expect(small.readFile("/workspace/big.txt")).rejects.toThrow(FileTooLargeError);
  });
});

// ── exists ──────────────────────────────────────────────────────────

describe("exists", () => {
  it("returns false for non-existent paths", async () => {
    expect(await provider.exists("/workspace/nope.txt")).toBe(false);
  });

  it("returns true for existing files", async () => {
    await provider.writeFile("/workspace/yep.txt", "hi");
    expect(await provider.exists("/workspace/yep.txt")).toBe(true);
  });

  it("returns true for existing directories", async () => {
    await provider.mkdir("/workspace/dir");
    expect(await provider.exists("/workspace/dir")).toBe(true);
  });
});

// ── stat ────────────────────────────────────────────────────────────

describe("stat", () => {
  it("returns file stat", async () => {
    await provider.writeFile("/workspace/file.txt", "content");
    const stat = await provider.stat("/workspace/file.txt");
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(7);
  });

  it("returns directory stat", async () => {
    await provider.mkdir("/workspace/dir");
    const stat = await provider.stat("/workspace/dir");
    expect(stat.isFile).toBe(false);
    expect(stat.isDirectory).toBe(true);
  });
});

// ── readdir ─────────────────────────────────────────────────────────

describe("readdir", () => {
  it("lists directory entries", async () => {
    await provider.writeFile("/workspace/a.txt", "a");
    await provider.writeFile("/workspace/b.txt", "b");
    await provider.mkdir("/workspace/subdir");

    const entries = await provider.readdir("/workspace");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");

    const subdir = entries.find((e) => e.name === "subdir")!;
    expect(subdir.isDirectory).toBe(true);
    expect(subdir.isFile).toBe(false);

    const file = entries.find((e) => e.name === "a.txt")!;
    expect(file.isFile).toBe(true);
    expect(file.isDirectory).toBe(false);
  });
});

// ── mkdir ───────────────────────────────────────────────────────────

describe("mkdir", () => {
  it("creates a directory", async () => {
    await provider.mkdir("/workspace/newdir");
    const stat = await provider.stat("/workspace/newdir");
    expect(stat.isDirectory).toBe(true);
  });

  it("creates nested directories with recursive", async () => {
    await provider.mkdir("/workspace/a/b/c", { recursive: true });
    const stat = await provider.stat("/workspace/a/b/c");
    expect(stat.isDirectory).toBe(true);
  });
});

// ── remove ──────────────────────────────────────────────────────────

describe("remove", () => {
  it("removes a file", async () => {
    await provider.writeFile("/workspace/bye.txt", "gone");
    await provider.remove("/workspace/bye.txt");
    expect(await provider.exists("/workspace/bye.txt")).toBe(false);
  });

  it("throws when removing directory without recursive", async () => {
    await provider.mkdir("/workspace/dir");
    await expect(provider.remove("/workspace/dir")).rejects.toThrow(/directory/i);
  });

  it("removes directory recursively", async () => {
    await provider.writeFile("/workspace/dir/a.txt", "a");
    await provider.writeFile("/workspace/dir/sub/b.txt", "b");
    await provider.remove("/workspace/dir", { recursive: true });
    expect(await provider.exists("/workspace/dir")).toBe(false);
  });
});

// ── rename ──────────────────────────────────────────────────────────

describe("rename", () => {
  it("renames a file", async () => {
    await provider.writeFile("/workspace/old.txt", "content");
    await provider.rename("/workspace/old.txt", "/workspace/new.txt");
    expect(await provider.exists("/workspace/old.txt")).toBe(false);
    const content = await provider.readFile("/workspace/new.txt");
    expect(content).toBe("content");
  });
});

// ── resolvePath ─────────────────────────────────────────────────────

describe("resolvePath", () => {
  it("returns absolute paths unchanged", () => {
    const resolved = provider.resolvePath("/workspace/file.txt");
    expect(resolved).toBe("/workspace/file.txt");
  });
});

// ── Integration with createFsTools ──────────────────────────────────

describe("integration with createFsTools", () => {
  it("tools work with VFS provider", async () => {
    // Dynamic import to avoid circular dependency issues at load time
    const { createFsTools } = await import("@openharness/core");

    const tools = createFsTools(provider);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exec = async (tool: any, input: any) =>
      tool.execute(input, { toolCallId: "test", messages: [] });

    // Write via tool
    await exec(tools.writeFile, { filePath: "/workspace/test.txt", content: "hello from tools" });

    // Read via tool
    const result = await exec(tools.readFile, { filePath: "/workspace/test.txt" });
    expect(result.content).toContain("hello from tools");
    expect(result.totalLines).toBe(1);

    // Edit via tool
    await exec(tools.editFile, {
      filePath: "/workspace/test.txt",
      oldString: "hello",
      newString: "goodbye",
      replaceAll: false,
    });
    const edited = await exec(tools.readFile, { filePath: "/workspace/test.txt" });
    expect(edited.content).toContain("goodbye from tools");

    // List via tool
    const listed = await exec(tools.listFiles, { dirPath: "/workspace", recursive: false });
    expect(listed.entries.some((e: { name: string }) => e.name === "test.txt")).toBe(true);

    // Delete via tool
    await exec(tools.deleteFile, { filePath: "/workspace/test.txt", recursive: false });
    expect(await provider.exists("/workspace/test.txt")).toBe(false);
  });
});
