---
"@openharness/core": minor
---

Add pagination support to the `listFiles` and `grep` filesystem tools. Both tools now accept optional `offset` and `limit` parameters and automatically paginate large results within the configured byte budget, returning a `status` message with instructions to fetch the next page. The default max output size is lowered from 50 KB to 32 KB.
