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
     8. AI_AUTH_MODE=oidc with VERCEL_OIDC_TOKEN / AI_GATEWAY_API_KEY env
        -> sends Authorization: Bearer <token>
     9. AI_AUTH_MODE=oidc with `x-vercel-oidc-token` request header
        (incl. array values) -> sends Authorization: Bearer <token>
    10. AI_AUTH_MODE=oidc, env var wins over request header
    11. AI_AUTH_MODE=oidc without any token -> 503 ai_oidc_unavailable
   Exits non-zero on failure. Only successful cases hit a (mocked) upstream. */

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

function resetEnv() {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_ALLOW_NO_KEY;
  delete process.env.AI_AUTH_MODE;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
}

async function run() {
  resetEnv();

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

  // ---- AI_AUTH_MODE=oidc with VERCEL_OIDC_TOKEN ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";
  process.env.VERCEL_OIDC_TOKEN = "stub-oidc-token";

  const captured4 = {};
  const restore4 = installMockFetch(captured4, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "oidc ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("oidc mode status", res.statusCode, 200);
    const hdrs4 = captured4.headers || {};
    const auth4 = hdrs4.Authorization || hdrs4.authorization;
    expect("oidc mode sends VERCEL_OIDC_TOKEN bearer", auth4, "Bearer stub-oidc-token");
    expect(
      "oidc mode upstream url",
      captured4.url,
      "https://ai-gateway.vercel.sh/v1/chat/completions"
    );
  } finally {
    restore4();
  }

  // ---- AI_AUTH_MODE=oidc with AI_GATEWAY_API_KEY (preferred over VERCEL_OIDC_TOKEN) ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";
  process.env.AI_GATEWAY_API_KEY = "vck-stub-gateway-key";
  process.env.VERCEL_OIDC_TOKEN = "stub-oidc-token";

  const captured5 = {};
  const restore5 = installMockFetch(captured5, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "oidc gateway-key ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("oidc gateway-key status", res.statusCode, 200);
    const hdrs5 = captured5.headers || {};
    const auth5 = hdrs5.Authorization || hdrs5.authorization;
    expect("oidc prefers AI_GATEWAY_API_KEY", auth5, "Bearer vck-stub-gateway-key");
  } finally {
    restore5();
  }

  // ---- AI_PROVIDER=vercel-ai-gateway alias also triggers OIDC ----
  resetEnv();
  process.env.AI_PROVIDER = "vercel-ai-gateway";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";
  process.env.VERCEL_OIDC_TOKEN = "alias-token";

  const captured6 = {};
  const restore6 = installMockFetch(captured6, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "alias ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
      res
    );
    expect("AI_PROVIDER alias status", res.statusCode, 200);
    const hdrs6 = captured6.headers || {};
    const auth6 = hdrs6.Authorization || hdrs6.authorization;
    expect("AI_PROVIDER alias sends bearer", auth6, "Bearer alias-token");
  } finally {
    restore6();
  }

  // ---- AI_AUTH_MODE=oidc with x-vercel-oidc-token request header ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";

  const captured7 = {};
  const restore7 = installMockFetch(captured7, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "oidc header ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq(
        "POST",
        { messages: [{ role: "user", content: "hi" }], language_code: "en" },
        { "x-vercel-oidc-token": "hdr-oidc-token" }
      ),
      res
    );
    expect("oidc header-token status", res.statusCode, 200);
    const hdrs7 = captured7.headers || {};
    const auth7 = hdrs7.Authorization || hdrs7.authorization;
    expect("oidc uses x-vercel-oidc-token header", auth7, "Bearer hdr-oidc-token");
  } finally {
    restore7();
  }

  // ---- AI_AUTH_MODE=oidc: env var still wins over the request header ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";
  process.env.VERCEL_OIDC_TOKEN = "env-token";

  const captured8 = {};
  const restore8 = installMockFetch(captured8, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "env wins" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq(
        "POST",
        { messages: [{ role: "user", content: "hi" }], language_code: "en" },
        { "x-vercel-oidc-token": "hdr-token" }
      ),
      res
    );
    expect("oidc env-precedence status", res.statusCode, 200);
    const hdrs8 = captured8.headers || {};
    const auth8 = hdrs8.Authorization || hdrs8.authorization;
    expect("VERCEL_OIDC_TOKEN env wins over header", auth8, "Bearer env-token");
  } finally {
    restore8();
  }

  // ---- AI_AUTH_MODE=oidc: header value as array (Node multi-value) ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
  process.env.AI_MODEL = "openai/gpt-4o-mini";

  const captured9 = {};
  const restore9 = installMockFetch(captured9, {
    model: "openai/gpt-4o-mini",
    choices: [{ message: { content: "array header ok" } }]
  });
  try {
    res = makeRes();
    await handler(
      makeReq(
        "POST",
        { messages: [{ role: "user", content: "hi" }], language_code: "en" },
        { "x-vercel-oidc-token": ["array-token", "second-value"] }
      ),
      res
    );
    expect("oidc array-header status", res.statusCode, 200);
    const hdrs9 = captured9.headers || {};
    const auth9 = hdrs9.Authorization || hdrs9.authorization;
    expect("array header uses first value", auth9, "Bearer array-token");
  } finally {
    restore9();
  }

  // ---- AI_AUTH_MODE=oidc but neither env nor header token present -> 503 ----
  resetEnv();
  process.env.AI_AUTH_MODE = "oidc";
  process.env.AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";

  res = makeRes();
  await handler(
    makeReq("POST", { messages: [{ role: "user", content: "hi" }], language_code: "en" }),
    res
  );
  expect("oidc missing token status", res.statusCode, 503);
  const body7 = JSON.parse(res.body);
  expect("oidc missing token error code", body7.error, "ai_oidc_unavailable");

  console.log("\nAll AI chat handler smoke checks passed.");
}

run().catch((e) => {
  console.error("[FAIL] unexpected:", e);
  process.exit(1);
});
