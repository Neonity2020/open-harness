---
"@openharness/core": patch
"@openharness/react": patch
"@openharness/vue": patch
"@openharness/provider-vfs": patch
---

Fix publish configuration for all packages. Add `publishConfig.access: "public"` so scoped packages can be published to npm, and switch internal workspace dependencies to `workspace:^` for correct version ranges in published tarballs.
