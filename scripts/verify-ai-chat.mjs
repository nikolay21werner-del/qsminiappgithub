#!/usr/bin/env node
/* Smoke test for the Vercel serverless AI endpoint (api/ai/chat.js).
   Drives the handler in-process with stub req/res objects. Validates:
     1. missing AI_API_KEY -> 503 ai_not_configured
     2. wrong HTTP method -> 405
     3. OPTIONS preflight -> 204
     4. empty messages -> 400
     5. assistant-only conversation -> 400 last_message_not_user
     6. AI_ALLOW_NO_KEY=true + no key -> succeeds and sends NO Authorization
        header to the (mocked) upstream provider
     7. AI_AUTH_MODE=none -> same behavior as AI_ALLOW_NO_KEY=true
   Exits non-zero on failure. Only call #6/#7 hit a (mocked) upstream. */

import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handler = require("../api/ai/chat.js");

function makeReq(method, body, headers) {
  const stream = Readable.from([JSON.stringify(body || {})]);
  stream.method = method;
  stream.headers = headers || {};
  return stream;
}

function makeRes() {
  return {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    end(body) { this.body = body; this._done = true; }
  };
}

function expect(label, actual, expected) {
  if (actual !== expected) {
    console.error(`[FAIL] ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  console.log(`[OK] ${label} -> ${JSON.stringify(actual)}`);
}

function installMockFetch(captured, replyJson) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    captured.url = String(url);
    captured.method = (init && init.method) || "GET";
    captured.headers = (init && init.headers) || {};
    captured.body = init && init.body;
    return {
      ok: true,
      status: 200,
      async json() { return replyJson; },
      async text() { return JSON.stringify(replyJson); }
    };
  };
  return () => { globalThis.fetch = realFetch; };
}

async function run() {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_ALLOW_NO_KEY;
  delete process.env.AI_AUTH_MODE;

  let res = makeRes();
  await handler(makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }), res);
  expect("missing AI_API_KEY", res.statusCode, 503);
  const body1 = JSON.parse(res.body);
  expect("error code", body1.error, "ai_not_configured");

  res = makeRes();
  await handler(makeReq("GET", {}), res);
  expect("GET not allowed", res.statusCode, 405);

  res = makeRes();
  await handler(makeReq("OPTIONS", {}), res);
  expect("OPTIONS preflight", res.statusCode, 204);

  process.env.AI_API_KEY = "sk-stub-for-validation-only";

  res = makeRes();
  await handler(makeReq("POST", { messages: [], language_code: "en" }), res);
  expect("empty messages", res.statusCode, 400);

  res = makeRes();
  await handler(makeReq("POST", { messages: [{ role: "assistant", content: "x" }], language_code: "en" }), res);
  expect("assistant-last", res.statusCode, 400);

  // ---- no-key mode (AI_ALLOW_NO_KEY=true) ----
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_ALLOW_NO_KEY = "true";
  process.env.AI_BASE_URL = "https://example.test/v1";
  process.env.AI_MODEL = "openai";

  const captured1 = {};
  const restore1 = installMockFetch(captured1, {
    model: "openai",
    choices: [{ message: { content: "stubbed reply" } }],
    usage: { total_tokens: 1 }
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("no-key mode status", res.statusCode, 200);
    const body6 = JSON.parse(res.body);
    expect("no-key mode content", body6.content, "stubbed reply");
    const hdrs = captured1.headers || {};
    const hasAuth =
      Object.prototype.hasOwnProperty.call(hdrs, "Authorization") ||
      Object.prototype.hasOwnProperty.call(hdrs, "authorization");
    expect("no Authorization header sent", hasAuth, false);
    expect(
      "upstream url",
      captured1.url,
      "https://example.test/v1/chat/completions"
    );
  } finally {
    restore1();
  }

  // ---- AI_AUTH_MODE=none (alias) ----
  delete process.env.AI_ALLOW_NO_KEY;
  process.env.AI_AUTH_MODE = "none";

  const captured2 = {};
  const restore2 = installMockFetch(captured2, {
    model: "openai",
    choices: [{ message: { content: "mode-none ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("auth-mode=none status", res.statusCode, 200);
    const hdrs2 = captured2.headers || {};
    const hasAuth2 =
      Object.prototype.hasOwnProperty.call(hdrs2, "Authorization") ||
      Object.prototype.hasOwnProperty.call(hdrs2, "authorization");
    expect("auth-mode=none: no Authorization header", hasAuth2, false);
  } finally {
    restore2();
  }

  // ---- bearer mode default: Authorization IS sent ----
  delete process.env.AI_AUTH_MODE;
  delete process.env.AI_ALLOW_NO_KEY;
  process.env.AI_API_KEY = "sk-test-real";

  const captured3 = {};
  const restore3 = installMockFetch(captured3, {
    model: "gpt-4o-mini",
    choices: [{ message: { content: "bearer ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("bearer mode status", res.statusCode, 200);
    const hdrs3 = captured3.headers || {};
    const auth = hdrs3.Authorization || hdrs3.authorization;
    expect("bearer mode sends Authorization", auth, "Bearer sk-test-real");
  } finally {
    restore3();
  }

  console.log("\nAll AI chat handler smoke checks passed.");
}

run().catch((e) => {
  console.error("[FAIL] unexpected:", e);
  process.exit(1);
});
