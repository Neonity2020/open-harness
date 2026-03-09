# OpenHarness UI — Package Design Specification

**Status:** Proposed
**Author:** Architecture session, March 2026
**Scope:** Changes to the `openharness` monorepo to support AI SDK 5 UI integration

---

## Background & Motivation

OpenHarness sessions emit a rich, stateful event stream — subagent lifecycle events, compaction, retries, turn boundaries, sandbox provisioning — that has no equivalent in the Vercel AI SDK's standard streaming protocol. When building a chat UI on top of OpenHarness today, developers face an awkward choice:

- Use `useChat` from `@ai-sdk/react`, which gives you all the UI primitives (abort, reconnect, json-render compatibility, etc.) but has no way to represent OpenHarness-specific events as first-class concepts. They must be smuggled through untyped `data` parts and handled in a secondary `onData` callback.
- Build a fully custom hook, which gives you first-class event types but requires re-implementing everything `useChat` already handles, and breaks compatibility with AI SDK ecosystem tools like json-render.

AI SDK 5 introduces two primitives that make a third path possible:

1. **Custom message types** — `UIMessage` is now generic; consumers can define their own typed data part union, making all session events first-class at the type level while still using `useChat` as the base.
2. **Custom transports** — `useChat` accepts a `ChatTransport` object, decoupling it from the `/api/chat` convention.

The goal of this work is to implement the stream conversion layer inside OpenHarness itself, so that any consumer can wire up a fully-typed, first-class AI SDK 5 chat UI with minimal boilerplate.

---

## What We Are Building

Two additions to the OpenHarness monorepo:

| Package | Type | Description |
|---|---|---|
| `@openharness/core` additions | Additions to existing package | `session.toUIMessageStream()`, `session.toResponse()`, exported types and formatters |
| `@openharness/react` | New package | React hooks and provider that consume the stream and expose first-class session state |

**Key design principle:** `@openharness/react` ships **no styled components**. It exports only hooks and a context provider. The consuming app owns all rendering. This keeps the library usable across any design system.

---

## Part 1: `@openharness/core` Additions

### 1.1 `session.toUIMessageStream(input: string): ReadableStream`

The core addition. Converts the OpenHarness async generator event stream into a `ReadableStream` that conforms to the AI SDK 5 data stream protocol.

**How it works internally:**

OpenHarness `session.send(input)` (or `session.run(input)`) returns an async generator that yields typed `OHEvent` objects. `toUIMessageStream` wraps this in a `ReadableStream` and maps each event to the appropriate AI SDK 5 stream part type.

```typescript
// Conceptual implementation
toUIMessageStream(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for await (const event of this.session.send(input)) {
        const part = mapOHEventToStreamPart(event);
        if (part) {
          controller.enqueue(encoder.encode(formatStreamPart(part)));
        }
      }
      controller.close();
    }
  });
}
```

**Event mapping table** (OpenHarness event → AI SDK 5 stream part type):

| OpenHarness Event | AI SDK 5 Stream Part | Notes |
|---|---|---|
| `text.delta` | `text-delta` | Direct mapping |
| `text.done` | `text-end` | Direct mapping |
| `reasoning.delta` | `reasoning-delta` | Direct mapping |
| `reasoning.done` | `reasoning-end` | Direct mapping |
| `tool.start` | `tool-call-streaming-start` | Direct mapping |
| `tool.input_delta` | `tool-call-delta` | Direct mapping |
| `tool.done` | `tool-result` | Direct mapping |
| `tool.error` | `tool-result` with error flag | Wrap error in result shape |
| `step.start` | `step-start` | Direct mapping |
| `step.done` | `step-finish` | Direct mapping |
| `done` | `finish-message` | Direct mapping |
| `subagent.start` | `data` part: `{ type: 'oh:subagent.start', ... }` | No AI SDK equivalent; use data side-channel |
| `subagent.done` | `data` part: `{ type: 'oh:subagent.done', ... }` | |
| `subagent.error` | `data` part: `{ type: 'oh:subagent.error', ... }` | |
| `compaction.start` | `data` part: `{ type: 'oh:compaction.start' }` | |
| `compaction.done` | `data` part: `{ type: 'oh:compaction.done' }` | |
| `retry` | `data` part: `{ type: 'oh:retry', attempt, reason }` | |
| `turn.start` | `data` part: `{ type: 'oh:turn.start', turnIndex }` | |
| `turn.done` | `data` part: `{ type: 'oh:turn.done', turnIndex }` | |
| `session.compacting` | `data` part: `{ type: 'oh:session.compacting' }` | |

**Important:** The `oh:` prefix namespaces OpenHarness data parts so they cannot clash with other consumers adding their own data parts.

**Note on subagent events:** Subagent events come via the `onSubagentEvent` callback in the current OpenHarness API, which is separate from the main generator. `toUIMessageStream` must subscribe to this callback internally and fan the events into the same stream as data parts. The implementation should use an internal queue or merge streams to handle this.

### 1.2 `session.toResponse(input: string): Response`

A convenience wrapper around `toUIMessageStream` that returns a `Response` object ready to return from any HTTP handler. This is what collapses the NestJS/Express endpoint to three lines.

```typescript
toResponse(input: string, init?: ResponseInit): Response {
  return new Response(this.toUIMessageStream(input), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...(init?.headers ?? {})
    },
    ...init
  });
}
```

Usage in a NestJS controller:

```typescript
@Post('stream')
async stream(@Body() body: { conversationId: string; message: string }) {
  const session = await this.agentService.getSession(body.conversationId);
  return session.toResponse(body.message);
}
```

Usage in a Next.js route handler (or any edge runtime):

```typescript
export async function POST(req: Request) {
  const { message, conversationId } = await req.json();
  const session = await getSession(conversationId);
  return session.toResponse(message);
}
```

### 1.3 Exported Types

These types should be exported from `@openharness/core` so consumers can use them without importing from `@openharness/react`.

**`OHDataPart`** — the union type of all OpenHarness-specific data parts:

```typescript
export type OHDataPart =
  | { type: 'oh:subagent.start'; agentName: string; task: string; parentAgent?: string }
  | { type: 'oh:subagent.done'; agentName: string; durationMs: number }
  | { type: 'oh:subagent.error'; agentName: string; error: string }
  | { type: 'oh:compaction.start' }
  | { type: 'oh:compaction.done'; messagesRemoved: number }
  | { type: 'oh:retry'; attempt: number; reason: string; delayMs: number }
  | { type: 'oh:turn.start'; turnIndex: number }
  | { type: 'oh:turn.done'; turnIndex: number; durationMs: number }
  | { type: 'oh:session.compacting' };
```

**`OHMetadata`** — per-message metadata attached to the `UIMessage`:

```typescript
export type OHMetadata = {
  agentName?: string;        // which agent produced this message
  sessionId?: string;
  turnIndex?: number;
  wasCompacted?: boolean;    // true if this message survived compaction
};
```

**`OHUIMessage`** — the pre-typed `UIMessage` generic for OpenHarness consumers:

```typescript
import type { UIMessage } from 'ai';
export type OHUIMessage = UIMessage<OHMetadata, OHDataPart>;
```

### 1.4 Type Guards (exported)

Utility functions for narrowing `OHDataPart` in consumer code:

```typescript
export const isSubagentEvent = (part: OHDataPart): part is OHSubagentPart =>
  part.type.startsWith('oh:subagent.');

export const isCompactionEvent = (part: OHDataPart): part is OHCompactionPart =>
  part.type.startsWith('oh:compaction.');

export const isRetryEvent = (part: OHDataPart): part is OHRetryPart =>
  part.type === 'oh:retry';

export const isSessionLifecycleEvent = (part: OHDataPart): part is OHSessionLifecyclePart =>
  part.type.startsWith('oh:turn.') || part.type === 'oh:session.compacting';
```

### 1.5 Stream Part Formatters (exported)

The internal functions used to format stream parts should be exported. This allows advanced consumers to write their own stream transformers, adapters, or test fixtures without reverse-engineering the internals.

```typescript
export function formatTextDelta(delta: string): string { ... }
export function formatDataPart(data: OHDataPart): string { ... }
export function formatToolCall(toolCall: OHToolCall): string { ... }
export function formatFinishMessage(usage?: OHUsage): string { ... }
```

---

## Part 2: `@openharness/react` (New Package)

A new package in the monorepo: `packages/react`. It depends on `@openharness/core` and `@ai-sdk/react`.

### 2.1 `OpenHarnessProvider`

A React context provider that holds the AI SDK 5 `Chat` instance (from `AbstractChat`) and fans the `onData` stream to all child hooks. This is necessary so that multiple hooks (`useSubagentStatus`, `useSessionStatus`, etc.) can all consume the same data stream without each independently subscribing.

```typescript
interface OpenHarnessProviderProps {
  chat: Chat<OHUIMessage>;   // AI SDK 5 Chat instance, pre-configured
  children: React.ReactNode;
}

export function OpenHarnessProvider({ chat, children }: OpenHarnessProviderProps) { ... }
```

The provider internally:
1. Subscribes to the `Chat` instance's `onData` callback
2. Dispatches incoming `OHDataPart` events to a shared event bus
3. Exposes the `Chat` instance and event bus via context

### 2.2 `useOpenHarness(config)`

The primary hook. A thin wrapper around AI SDK 5's `useChat` with:
- `OHUIMessage` as the message type parameter
- The transport pre-wired (see `createOHTransport` below)
- `onData` routed into the provider's event dispatcher

```typescript
interface UseOpenHarnessConfig {
  endpoint: string;         // Your SSE endpoint URL
  conversationId?: string;
  headers?: Record<string, string>;
  onFinish?: (message: OHUIMessage) => void;
}

export function useOpenHarness(config: UseOpenHarnessConfig) {
  // Returns the same shape as useChat<OHUIMessage>
  // Plus: the Chat instance is registered with the nearest OpenHarnessProvider
}
```

Return type is the full `useChat` return shape — `messages`, `sendMessage`, `status`, `stop`, etc. — typed with `OHUIMessage`.

### 2.3 `useSubagentStatus()`

Derives real-time subagent state from the provider's event stream. No polling, no manual `onData` wiring.

```typescript
interface SubagentInfo {
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  parentAgent?: string;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

export function useSubagentStatus(): {
  activeSubagents: SubagentInfo[];    // currently running
  recentSubagents: SubagentInfo[];    // completed in last N messages
  hasActiveSubagents: boolean;
}
```

### 2.4 `useSessionStatus()`

Derives session lifecycle state:

```typescript
export function useSessionStatus(): {
  isCompacting: boolean;
  isRetrying: boolean;
  retryAttempt: number;       // 0 when not retrying
  retryReason: string | null;
  currentTurn: number;
  lastCompactionAt: Date | null;
  messagesRemovedByCompaction: number;
}
```

### 2.5 `useSandboxStatus()`

Derives sandbox provisioning state. This is relevant when the session uses a sandboxed tool executor (e.g. Cloudflare Sandbox SDK). The sandbox events would need to be emitted by the agent layer, not OpenHarness core — but the hook should exist here so the consuming app has a standard contract.

> **Note:** This hook depends on the agent layer emitting `oh:sandbox.*` data parts. If your agent setup doesn't use a sandbox, this hook is a no-op. The actual sandbox events (`oh:sandbox.provisioning`, `oh:sandbox.ready`) should be emitted by the tool executor layer before being passed through `toUIMessageStream`.

```typescript
export function useSandboxStatus(): {
  isProvisioning: boolean;
  isWarm: boolean;
  provisioningMessage: string | null;  // e.g. "Setting up your workspace…"
  provisionedAt: Date | null;
}
```

### 2.6 `createOHTransport(endpoint, opts?)`

A factory function that creates a pre-configured `DefaultChatTransport` pointed at the caller's SSE endpoint. Removes the need for consumers to import `DefaultChatTransport` from the AI SDK directly.

```typescript
interface OHTransportOptions {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
}

export function createOHTransport(
  endpoint: string,
  opts?: OHTransportOptions
): ChatTransport { ... }
```

---

## How These Pieces Fit Together

### In the server (NestJS example)

```typescript
// agent.controller.ts
@Post('stream')
async stream(@Body() body: StreamDto, @Res() res: Response) {
  const session = await this.sessionManager.get(body.conversationId);
  return session.toResponse(body.message);
}
```

That's the entire server-side implementation. All the complexity of mapping OH events to AI SDK parts happens inside `toResponse`.

### In the React app

```typescript
// App.tsx
import { OpenHarnessProvider, useOpenHarness, createOHTransport } from '@openharness/react';
import { Chat } from 'ai';
import type { OHUIMessage } from '@openharness/core';

const chat = new Chat<OHUIMessage>({
  transport: createOHTransport('/api/agent/stream')
});

function App() {
  return (
    <OpenHarnessProvider chat={chat}>
      <ChatView />
    </OpenHarnessProvider>
  );
}

// ChatView.tsx
function ChatView() {
  const { messages, sendMessage, status } = useOpenHarness({
    endpoint: '/api/agent/stream'
  });
  const { activeSubagents } = useSubagentStatus();
  const { isCompacting, currentTurn } = useSessionStatus();

  return (
    <div>
      {isCompacting && <div>Compacting conversation history…</div>}
      {activeSubagents.map(a => (
        <div key={a.name}>Agent {a.name}: {a.task}</div>
      ))}
      {messages.map(m => <MessageBubble key={m.id} message={m} />)}
    </div>
  );
}
```

### With json-render (JIT UI)

Because `useOpenHarness` is built on `useChat`, json-render works without any additional wiring:

```typescript
import { useJsonRenderMessage } from '@json-render/react';

function MessageBubble({ message }: { message: OHUIMessage }) {
  const rendered = useJsonRenderMessage(message);
  return <div>{rendered}</div>;
}
```

---

## Package Structure

```
packages/
  core/                        # existing
    src/
      session.ts               # ADD: toUIMessageStream(), toResponse()
      types/
        ui-message.ts          # NEW: OHDataPart, OHMetadata, OHUIMessage
        stream-parts.ts        # NEW: formatters + type guards
      index.ts                 # re-export all new types + methods

  react/                       # NEW package
    package.json
    src/
      provider.tsx             # OpenHarnessProvider + context
      hooks/
        use-open-harness.ts    # useOpenHarness()
        use-subagent-status.ts # useSubagentStatus()
        use-session-status.ts  # useSessionStatus()
        use-sandbox-status.ts  # useSandboxStatus()
      transport.ts             # createOHTransport()
      index.ts                 # re-export everything
    tsconfig.json
    README.md
```

---

## What Stays Out of This Package

The following belong in the **consuming app**, not in `@openharness/react`:

- Any styled UI components (chat bubbles, spinners, banners)
- Application-specific event type extensions beyond `OHDataPart`
- Credential injection or workspace context
- The `useChat` → `Chat` instance lifecycle (create, destroy, persist — app concern)
- json-render component catalog (`Table`, `Form`, `DetailCard`, etc.)

The library is a **state machine and stream adapter**. The app owns the pixels.

---

## Open Questions for Implementer

1. **Subagent event merging:** The current OpenHarness API delivers subagent events via `onSubagentEvent` callback, which is out-of-band from the main generator. `toUIMessageStream` needs to merge these into the main stream in correct temporal order. Recommend using an internal async queue. Worth discussing whether the callback API should be changed to yield from the main generator instead.

2. **Backpressure:** If the consumer of the `ReadableStream` is slow (e.g. the browser connection is congested), the internal queue could grow unbounded during subagent merging. Define a max queue size and behaviour on overflow (drop or block).

3. **`oh:sandbox.*` events:** These are defined in the type system here but depend on the tool executor layer emitting them. If OpenHarness core doesn't own the sandbox, document clearly that these events must be emitted by the caller via an escape hatch (e.g. `session.emitDataPart(part: OHDataPart)`) before `toUIMessageStream` will surface them.

4. **AI SDK 5 stability:** As of March 2026, AI SDK 5 is in beta. The `AbstractChat` class and custom message type API may have breaking changes before GA. Pin the peer dependency to a specific beta version and note this prominently in the README.

5. **`toResponse` and edge runtimes:** The `Response` constructor is available in edge runtimes (Cloudflare Workers, Vercel Edge) and in Node 18+. For older Node environments, consumers will need to use `toUIMessageStream` directly and construct their own response. Document this.

6. **History ownership:** `useChat` (and therefore `useOpenHarness`) manages message history client-side. OpenHarness `Session` manages it server-side for compaction purposes. These are explicitly different things in AI SDK 5 (`UIMessage` vs `ModelMessage`), so there is no conflict — but document this separation clearly so consumers don't try to sync them.

---

## Acceptance Criteria

- [ ] `session.toUIMessageStream(input)` emits a valid AI SDK 5 data stream for all event types in the mapping table above
- [ ] `session.toResponse(input)` returns a `Response` with correct `Content-Type: text/event-stream` header
- [ ] All `OHDataPart` variants are exported and fully typed
- [ ] All type guards are exported and correctly narrow the union
- [ ] Stream part formatters are exported
- [ ] `@openharness/react` package builds independently with no circular deps on core
- [ ] `useOpenHarness` returns the same shape as `useChat<OHUIMessage>`
- [ ] `useSubagentStatus`, `useSessionStatus`, `useSandboxStatus` all update reactively without consumer wiring `onData` manually
- [ ] `OpenHarnessProvider` correctly fans events to all child hooks without duplicate subscriptions
- [ ] `createOHTransport` produces a transport that works with `new Chat({ transport })` from AI SDK 5
- [ ] A working example app (in `examples/`) demonstrates the full stack: NestJS endpoint → `toResponse` → `useOpenHarness` → all derived hooks
- [ ] No styled components ship in `@openharness/react`
- [ ] README documents the separation between `OHUIMessage` (UI state) and `ModelMessage` (LLM context)