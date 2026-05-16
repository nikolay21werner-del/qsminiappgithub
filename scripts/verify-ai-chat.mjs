#!/usr/bin/env node
/* Smoke test for the Vercel serverless AI endpoint (api/ai/chat.js).
   Drives the handler in-process with stub req/res objects. Validates:
     1. missing AI_API_KEY -> 503 ai_not_configured
     2. wrong HTTP method -> 405
     3. OPTIONS preflight -> 204
     4. empty messages -> 400
     5. assistant-only conversation -> 400 last_message_not_user
   Exits non-zero on failure. Does NOT make real network calls. */

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
    console.error(`[FAIL] ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`[OK] ${label} -> ${actual}`);
}

async function run() {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;

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

  console.log("\nAll AI chat handler smoke checks passed.");
}

run().catch((e) => {
  console.error("[FAIL] unexpected:", e);
  process.exit(1);
});
