import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ADMIN_PASSWORD, basic, MCP_TOKEN, MockOura, startApp } from "./helpers.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { loadConfig } from "../src/config.js";
import { bucketHeartRate, resolveDateRange, summarizeHrv } from "../src/tools.js";

type App = Awaited<ReturnType<typeof startApp>>;

async function connectMcp(url: string, token = MCP_TOKEN) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

/** Drive the real OAuth flow end-to-end against the mock Oura. */
async function connectOura(app: App) {
  const start = await fetch(`${app.url}/oauth/start`, { headers: { Authorization: basic(ADMIN_PASSWORD) }, redirect: "manual" });
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("location")!);
  const state = authorize.searchParams.get("state")!;
  const cb = await fetch(`${app.url}/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 200);
  return authorize;
}

function parse(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text);
}

describe("configuration", () => {
  test("rejects weak or missing secrets", () => {
    assert.throws(() => loadConfig({}), /Invalid configuration/);
    assert.throws(
      () =>
        loadConfig({
          PUBLIC_BASE_URL: "http://localhost:8080",
          OURA_CLIENT_ID: "x",
          OURA_CLIENT_SECRET: "y",
          MCP_AUTH_TOKENS: "short",
          ADMIN_PASSWORD: "short",
          TOKEN_ENCRYPTION_KEY: "abc",
        }),
      /MCP auth token must be at least 32|ADMIN_PASSWORD|TOKEN_ENCRYPTION_KEY/,
    );
  });

  test("requires https in production", () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "production",
          PUBLIC_BASE_URL: "http://example.com",
          OURA_CLIENT_ID: "x",
          OURA_CLIENT_SECRET: "y",
          MCP_AUTH_TOKENS: MCP_TOKEN,
          ADMIN_PASSWORD,
          TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        }),
      /https/,
    );
  });
});

describe("encryption", () => {
  test("round-trips and detects tampering", () => {
    const key = randomBytes(32);
    const blob = encrypt("secret", key);
    assert.equal(decrypt(blob, key), "secret");
    const tampered = { ...blob, data: Buffer.from("xxxxxx").toString("base64") };
    assert.throws(() => decrypt(tampered, key));
    assert.throws(() => decrypt(blob, randomBytes(32)));
  });
});

describe("HTTP security", () => {
  let oura: MockOura;
  let app: App;
  before(async () => {
    oura = await new MockOura().start();
    app = await startApp(oura);
  });
  after(async () => {
    await app.stop();
    await oura.stop();
  });

  test("/mcp rejects missing and wrong bearer tokens", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const none = await fetch(`${app.url}/mcp`, { method: "POST", headers, body });
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
    const wrong = await fetch(`${app.url}/mcp`, { method: "POST", headers: { ...headers, Authorization: "Bearer nope" }, body });
    assert.equal(wrong.status, 401);
    await assert.rejects(connectMcp(app.url, "x".repeat(40)));
  });

  test("GET /mcp is not allowed (stateless server)", async () => {
    const res = await fetch(`${app.url}/mcp`, { headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    assert.equal(res.status, 405);
  });

  test("admin routes require the admin password", async () => {
    assert.equal((await fetch(`${app.url}/oauth/start`, { redirect: "manual" })).status, 401);
    assert.equal((await fetch(`${app.url}/oauth/start`, { headers: { Authorization: basic("wrong-password-xx") }, redirect: "manual" })).status, 401);
    assert.equal((await fetch(`${app.url}/oauth/status`)).status, 401);
  });

  test("callback rejects unknown state (CSRF protection)", async () => {
    const res = await fetch(`${app.url}/oauth/callback?code=good-code&state=forged`);
    assert.equal(res.status, 400);
    const status = await (await fetch(`${app.url}/oauth/status`, { headers: { Authorization: basic(ADMIN_PASSWORD) } })).json();
    assert.equal(status.connected, false);
  });

  test("health check exposes nothing and responses are not cacheable", async () => {
    const res = await fetch(`${app.url}/healthz`);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("tools explain how to connect before Oura is linked", async () => {
    const client = await connectMcp(app.url);
    const result = await client.callTool({ name: "get_daily_sleep", arguments: {} });
    assert.equal(result.isError, true);
    assert.match((result.content as { text: string }[])[0].text, /not connected/);
    await client.close();
  });
});

describe("OAuth + tools", () => {
  let oura: MockOura;
  let app: App;
  before(async () => {
    oura = await new MockOura().start();
    app = await startApp(oura);
  });
  after(async () => {
    await app.stop();
    await oura.stop();
  });

  test("OAuth flow builds a correct authorize URL and stores tokens encrypted", async () => {
    const authorize = await connectOura(app);
    assert.equal(authorize.searchParams.get("client_id"), "test-client-id");
    assert.equal(authorize.searchParams.get("redirect_uri"), "http://127.0.0.1:9999/oauth/callback");
    assert.equal(authorize.searchParams.get("scope"), "personal daily heartrate");
    assert.equal(authorize.searchParams.get("response_type"), "code");

    const raw = await readFile(path.join(app.dataDir, "oura-tokens.enc.json"), "utf8");
    assert.ok(!raw.includes("at-1") && !raw.includes("rt-1"), "tokens must not be stored in plaintext");

    // A state value can only be used once.
    const state = authorize.searchParams.get("state")!;
    assert.equal((await fetch(`${app.url}/oauth/callback?code=good-code&state=${state}`)).status, 400);
  });

  test("lists exactly the six read-only tools", async () => {
    const client = await connectMcp(app.url);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["get_daily_activity", "get_daily_readiness", "get_daily_sleep", "get_heart_rate", "get_hrv", "get_sleep_sessions"],
    );
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be read-only`);
      assert.equal(t.annotations?.destructiveHint, false);
    }
    await client.close();
  });

  test("get_daily_sleep follows pagination and trims to the requested range", async () => {
    const client = await connectMcp(app.url);
    const out = parse(await client.callTool({ name: "get_daily_sleep", arguments: { start_date: "2026-11-05", end_date: "2026-11-07" } }));
    assert.deepEqual(out.days.map((d: { day: string }) => d.day), ["2026-11-05", "2026-11-06", "2026-11-07"]);
    const calls = oura.apiCalls.filter((c) => c.path === "daily_sleep");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].query.next_token, "page2");
    await client.close();
  });

  test("get_sleep_sessions omits bulky samples unless asked", async () => {
    const client = await connectMcp(app.url);
    const args = { start_date: "2026-11-05", end_date: "2026-11-06" };
    const lean = parse(await client.callTool({ name: "get_sleep_sessions", arguments: args }));
    assert.equal(lean.sessions[0].hrv, undefined);
    assert.equal(lean.sessions[0].movement_30_sec, undefined);
    assert.equal(lean.sessions[0].average_hrv, 50);
    const full = parse(await client.callTool({ name: "get_sleep_sessions", arguments: { ...args, include_samples: true } }));
    assert.ok(full.sessions[0].hrv.items);
    await client.close();
  });

  test("get_hrv summarizes main-sleep HRV and joins readiness HRV balance", async () => {
    const client = await connectMcp(app.url);
    const out = parse(await client.callTool({ name: "get_hrv", arguments: { start_date: "2026-11-05", end_date: "2026-11-06", include_samples: true } }));
    assert.equal(out.summary.mean, 60); // (50 + 70) / 2, nap excluded
    assert.equal(out.summary.count, 2);
    assert.equal(out.nights[0].readiness_hrv_balance_score, 77);
    assert.deepEqual(out.nights[0].hrv_samples_ms.map((s: { value: number }) => s.value), [40, 60]);
    await client.close();
  });

  test("get_daily_readiness and get_daily_activity return data", async () => {
    const client = await connectMcp(app.url);
    const r = parse(await client.callTool({ name: "get_daily_readiness", arguments: { start_date: "2026-11-05", end_date: "2026-11-05" } }));
    assert.equal(r.days[0].score, 85);
    const a = parse(await client.callTool({ name: "get_daily_activity", arguments: { start_date: "2026-11-05", end_date: "2026-11-05" } }));
    assert.equal(a.days[0].steps, 9000);
    assert.equal(a.days[0].class_5_min, undefined);
    await client.close();
  });

  test("get_heart_rate buckets readings hourly", async () => {
    const client = await connectMcp(app.url);
    const out = parse(
      await client.callTool({
        name: "get_heart_rate",
        arguments: { start_datetime: "2026-11-05T10:00:00Z", end_datetime: "2026-11-05T12:00:00Z" },
      }),
    );
    assert.equal(out.total_samples, 3);
    assert.deepEqual(out.data[0], { period_start_utc: "2026-11-05T10:00:00.000Z", samples: 2, min_bpm: 60, avg_bpm: 65, max_bpm: 70, sources: ["awake"] });
    await client.close();
  });

  test("invalid input is rejected with a helpful message", async () => {
    const client = await connectMcp(app.url);
    const bad = await client.callTool({ name: "get_daily_sleep", arguments: { start_date: "2026-11-10", end_date: "2026-11-01" } });
    assert.equal(bad.isError, true);
    const tooLong = await client.callTool({ name: "get_heart_rate", arguments: { start_datetime: "2026-10-01T00:00:00Z", end_datetime: "2026-11-01T00:00:00Z" } });
    assert.equal(tooLong.isError, true);
    const notADate = await client.callTool({ name: "get_daily_sleep", arguments: { start_date: "2026-02-30" } });
    assert.equal(notADate.isError, true);
    await client.close();
  });

  test("a 401 from Oura triggers one refresh, then succeeds", async () => {
    oura.validAccess.clear(); // simulate Oura revoking the current access token
    const before = oura.refreshCalls;
    const client = await connectMcp(app.url);
    const out = parse(await client.callTool({ name: "get_daily_readiness", arguments: { start_date: "2026-11-05", end_date: "2026-11-05" } }));
    assert.equal(out.days[0].score, 85);
    assert.equal(oura.refreshCalls, before + 1);
    await client.close();
  });
});

describe("token refresh", () => {
  test("expired tokens are refreshed once (even under concurrency) and the rotated refresh token is persisted", async () => {
    const oura = await new MockOura().start();
    oura.expiresIn = 60; // already inside the 5-minute refresh window
    const app = await startApp(oura);
    try {
      await connectOura(app);
      const client = await connectMcp(app.url);
      const calls = await Promise.all(
        Array.from({ length: 5 }, () => client.callTool({ name: "get_daily_readiness", arguments: { start_date: "2026-11-05", end_date: "2026-11-05" } })),
      );
      for (const c of calls) assert.notEqual(c.isError, true);
      // 5 concurrent tool calls -> exactly 1 refresh (single-use refresh tokens!)
      assert.equal(oura.refreshCalls, 1);
      // The rotated refresh token (rt-2) was saved: a further refresh must work.
      const tokens = await app.auth.refresh();
      assert.equal(tokens.refresh_token, "rt-3");
      await client.close();
    } finally {
      await app.stop();
      await oura.stop();
    }
  });

  test("a revoked refresh token tells the agent to reconnect", async () => {
    const oura = await new MockOura().start();
    oura.expiresIn = 60;
    const app = await startApp(oura);
    try {
      await connectOura(app);
      oura.validRefresh.clear(); // user revoked access in the Oura app
      const client = await connectMcp(app.url);
      const result = await client.callTool({ name: "get_daily_sleep", arguments: {} });
      assert.equal(result.isError, true);
      assert.match((result.content as { text: string }[])[0].text, /reconnect/);
      await client.close();
    } finally {
      await app.stop();
      await oura.stop();
    }
  });
});

describe("pure helpers", () => {
  test("resolveDateRange defaults to the last 7 days and enforces limits", () => {
    const now = Date.parse("2026-11-12T15:00:00Z");
    assert.deepEqual(resolveDateRange(undefined, undefined, 90, now), { start: "2026-11-06", end: "2026-11-12" });
    assert.throws(() => resolveDateRange("2026-01-01", "2026-11-01", 90, now), /maximum is 90/);
  });

  test("bucketHeartRate daily + raw", () => {
    const s = [
      { bpm: 60, timestamp: "2026-11-05T01:00:00Z" },
      { bpm: 80, timestamp: "2026-11-05T23:00:00Z" },
    ];
    assert.equal(bucketHeartRate(s, "daily").length, 1);
    assert.equal(bucketHeartRate(s, "raw").length, 2);
  });

  test("summarizeHrv falls back to all periods when there is no main sleep", () => {
    const out = summarizeHrv([{ day: "2026-11-05", type: "sleep", average_hrv: 30 }], [], false);
    assert.equal(out.summary.mean, 30);
    assert.match(out.summary.basis, /all/);
  });
});
