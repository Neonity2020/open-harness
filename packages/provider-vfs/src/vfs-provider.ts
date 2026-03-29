import type { FsProvider, FileStat, DirEntry } from "@openharness/core/providers";

// ── Types for the VFS module (node:vfs or @platformatic/vfs) ────────
// We declare minimal types here to avoid a hard dependency on @platformatic/vfs
// at the type level. Both node:vfs and @platformatic/vfs expose the same API.

interface VfsStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
}

interface VfsDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

interface VfsPromisesApi {
  readFile(path: string, options?: { encoding?: string } | string): Promise<string | Buffer>;
  writeFile(path: string, data: string | Buffer, options?: { encoding?: string } | string): Promise<void>;
  stat(path: string): Promise<VfsStats>;
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | VfsDirent[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  access(path: string, mode?: number): Promise<void>;
}

interface VirtualFileSystem {
  promises: VfsPromisesApi;
  existsSync(path: string): boolean;
  resolvePath(path: string): string;
  mount(prefix: string): VirtualFileSystem;
  unmount(): void;
  readonly mounted: boolean;
}

interface VfsModule {
  create(provider?: unknown, options?: VfsCreateOptions): VirtualFileSystem;
  create(options?: VfsCreateOptions): VirtualFileSystem;
  MemoryProvider: new () => unknown;
  SqliteProvider: new (path?: string) => unknown;
  RealFSProvider: new (rootPath: string) => unknown;
}

interface VfsCreateOptions {
  moduleHooks?: boolean;
  overlay?: boolean;
  virtualCwd?: boolean;
}

// ── Runtime module resolution ───────────────────────────────────────

let cachedModule: VfsModule | undefined;

async function getVfsModule(): Promise<VfsModule> {
  if (cachedModule) return cachedModule;

  try {
    // Try native node:vfs first (future Node.js versions)
    // @ts-expect-error -- node:vfs does not exist yet; will resolve once Node ships it
    cachedModule = (await import("node:vfs")) as VfsModule;
  } catch {
    try {
      // Fall back to userland @platformatic/vfs
      cachedModule = (await import("@platformatic/vfs")) as VfsModule;
    } catch {
      throw new Error(
        "No VFS module available. Install @platformatic/vfs (requires Node >= 22) " +
          "or use a Node.js version with built-in node:vfs support.",
      );
    }
  }

  return cachedModule;
}

// ── VfsFsProvider ───────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface VfsFsProviderOptions {
  /** A pre-created VirtualFileSystem instance. If provided, provider/vfsOptions/mountPoint are ignored. */
  vfs?: VirtualFileSystem;

  /** VFS provider instance (MemoryProvider, SqliteProvider, RealFSProvider). Defaults to MemoryProvider. */
  provider?: unknown;

  /** Options passed to vfs create(). Defaults to { moduleHooks: false, virtualCwd: true }. */
  vfsOptions?: VfsCreateOptions;

  /** Mount point for the VFS. Defaults to "/workspace". */
  mountPoint?: string;

  /** Maximum file size in bytes that readFile will load. Defaults to 10 MB. */
  maxFileSize?: number;
}

export class VfsFsProvider implements FsProvider {
  private vfs: VirtualFileSystem | undefined;
  private initPromise: Promise<void> | undefined;
  private options: VfsFsProviderOptions;
  private maxFileSize: number;

  constructor(options?: VfsFsProviderOptions) {
    this.options = options ?? {};
    this.maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

    if (options?.vfs) {
      this.vfs = options.vfs;
    }
  }

  private async ensureInitialized(): Promise<VirtualFileSystem> {
    if (this.vfs) return this.vfs;

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
    return this.vfs!;
  }

  private async initialize(): Promise<void> {
    const mod = await getVfsModule();

    const provider = this.options.provider ?? new (mod.MemoryProvider as new () => unknown)();
    const vfsOptions: VfsCreateOptions = this.options.vfsOptions ?? {
      moduleHooks: false,
      virtualCwd: true,
    };

    this.vfs = mod.create(provider, vfsOptions);

    const mountPoint = this.options.mountPoint ?? "/workspace";
    if (!this.vfs.mounted) {
      this.vfs.mount(mountPoint);
    }

    // Initialize virtual CWD to the mount point
    if (vfsOptions.virtualCwd !== false) {
      this.vfs.resolvePath(mountPoint);
    }
  }

  /** Get the underlying VirtualFileSystem instance (initializes lazily if needed). */
  async getVfs(): Promise<VirtualFileSystem> {
    return this.ensureInitialized();
  }

  resolvePath(filePath: string): string {
    if (!this.vfs) {
      // Before initialization, return the path as-is — the caller should
      // await an operation (which triggers init) before using resolvePath.
      const mountPoint = this.options.mountPoint ?? "/workspace";
      if (filePath.startsWith("/")) return filePath;
      return mountPoint + (mountPoint.endsWith("/") ? "" : "/") + filePath;
    }
    return this.vfs.resolvePath(filePath);
  }

  async readFile(filePath: string): Promise<string> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(filePath);

    // Size guard
    const stat = await vfs.promises.stat(resolved);
    if (stat.size > this.maxFileSize) {
      throw new FileTooLargeError(resolved, stat.size, this.maxFileSize);
    }

    const content = await vfs.promises.readFile(resolved, "utf-8");
    return typeof content === "string" ? content : content.toString("utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(filePath);

    // Create parent directories
    const parentDir = dirname(resolved);
    if (parentDir !== resolved) {
      await vfs.promises.mkdir(parentDir, { recursive: true });
    }

    await vfs.promises.writeFile(resolved, content, "utf-8");
  }

  async exists(filePath: string): Promise<boolean> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(filePath);
    try {
      await vfs.promises.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(filePath);
    const stat = await vfs.promises.stat(resolved);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    };
  }

  async readdir(dirPath: string): Promise<DirEntry[]> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(dirPath);
    const entries = (await vfs.promises.readdir(resolved, { withFileTypes: true })) as VfsDirent[];
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
    }));
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(dirPath);
    await vfs.promises.mkdir(resolved, { recursive: options?.recursive });
  }

  async remove(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const vfs = await this.ensureInitialized();
    const resolved = vfs.resolvePath(filePath);
    const stat = await vfs.promises.stat(resolved);

    if (stat.isDirectory()) {
      if (!options?.recursive) {
        throw new Error(`Path is a directory. Set recursive to true to delete it: ${resolved}`);
      }
      await this.removeRecursive(vfs, resolved);
    } else {
      await vfs.promises.unlink(resolved);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const vfs = await this.ensureInitialized();
    await vfs.promises.rename(vfs.resolvePath(oldPath), vfs.resolvePath(newPath));
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Recursively remove a directory since VFS lacks `rm`. */
  private async removeRecursive(vfs: VirtualFileSystem, dirPath: string): Promise<void> {
    const entries = (await vfs.promises.readdir(dirPath, { withFileTypes: true })) as VfsDirent[];

    for (const entry of entries) {
      const fullPath = dirPath + "/" + entry.name;
      if (entry.isDirectory()) {
        await this.removeRecursive(vfs, fullPath);
      } else {
        await vfs.promises.unlink(fullPath);
      }
    }

    await vfs.promises.rmdir(dirPath);
  }
}

// ── Errors ──────────────────────────────────────────────────────────

export class FileTooLargeError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly fileSize: number,
    public readonly maxSize: number,
  ) {
    super(
      `File too large: ${filePath} is ${formatBytes(fileSize)} (limit: ${formatBytes(maxSize)}). ` +
        `Use offset and limit parameters to read a portion of the file, or use grep to search it.`,
    );
    this.name = "FileTooLargeError";
  }
}

// ── Utilities ───────────────────────────────────────────────────────

function dirname(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return filePath.slice(0, lastSlash);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Convenience: re-export getVfsModule for advanced usage ──────────

export { getVfsModule };
