# @openharness/provider-chatgpt

ChatGPT/Codex OAuth model provider for OpenHarness. It lets SDK consumers build their own login UX, store a user's ChatGPT OAuth tokens, and pass a Vercel AI SDK language model into `@openharness/core`.

This package is experimental. It uses the local Codex-style ChatGPT OAuth flow and the ChatGPT Codex backend surface, not the public OpenAI Platform API billing path.

## Install

```bash
npm install @openharness/provider-chatgpt @openharness/core
```

## Usage

```typescript
import { Agent } from "@openharness/core";
import {
  FileTokenStore,
  createChatGPTAuth,
  createChatGPTProvider,
} from "@openharness/provider-chatgpt";

const auth = createChatGPTAuth({
  tokenStore: new FileTokenStore("~/.my-harness/chatgpt-auth.json"),
});

const chatgpt = createChatGPTProvider({ auth });

const agent = new Agent({
  name: "coder",
  model: chatgpt("gpt-5.2-codex"),
});
```

## Browser Callback Login

OpenHarness does not provide a CLI. Host apps can trigger the login flow wherever it fits their UX.

```typescript
await auth.loginWithLocalCallback({
  port: 1455,
  openBrowser: true,
});
```

For custom callback handling:

```typescript
import { parseAuthorizationCallback } from "@openharness/provider-chatgpt";

const flow = await auth.createAuthorizationFlow();

console.log(flow.authorizationUrl);

const { code, state } = parseAuthorizationCallback(callbackUrlOrQueryString);

await auth.exchangeCode({
  code: code!,
  state,
  expectedState: flow.state,
  codeVerifier: flow.codeVerifier,
  redirectUri: flow.redirectUri,
});
```

## Device Login

For headless environments:

```typescript
const flow = await auth.startDeviceFlow();

console.log(flow.verificationUrl);
console.log(flow.userCode);

await flow.pollUntilComplete();
```

## Token Stores

Credential storage is pluggable:

```typescript
import {
  FileTokenStore,
  MemoryTokenStore,
  OpenCodeTokenStore,
} from "@openharness/provider-chatgpt";
```

`OpenCodeTokenStore` reads and writes OpenCode's `openai` auth entry explicitly. The package does not silently read another tool's credentials.

You can provide your own store:

```typescript
const tokenStore = {
  async get() {
    return tokens;
  },
  async set(next) {
    tokens = next;
  },
  async clear() {
    tokens = null;
  },
};
```

## Request Behavior

The provider wraps `@ai-sdk/openai` Responses models and rewrites requests to the ChatGPT Codex backend:

```txt
https://chatgpt.com/backend-api/responses
https://chatgpt.com/backend-api/codex/responses
```

It refreshes OAuth tokens, injects the ChatGPT account id header, forces stateless `store: false`, requests encrypted reasoning continuity, and converts Codex SSE responses back to JSON for non-streaming AI SDK calls.

## License

MIT
