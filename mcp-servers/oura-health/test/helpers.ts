import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig, type Config } from "../src/config.js";
import { createApp } from "../src/server.js";

export const MCP_TOKEN = "test-mcp-token-0123456789abcdefghijklmnop";
export const ADMIN_PASSWORD = "test-admin-password-123";
export const CLIENT_ID = "test-client-id";
export const CLIENT_SECRET = "test-client-secret";

/**
 * A fake Oura: OAuth token endpoint + a few /v2/usercollection endpoints.
 * Refresh tokens are single-use, like the real thing.
 */
export class MockOura {
  server!: Server;
  url!: string;
  validAccess = new Set<string>();
  validRefresh = new Set<string>();
  refreshCalls = 0;
  apiCalls: { path: string; query: Record<string, string> }[] = [];
  expiresIn = 86_400;
  private counter = 0;

  async start() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (req.method === "POST" && url.pathname === "/oauth/token") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const form = new URLSearchParams(raw);
        if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
          return send(401, { error: "invalid_client" });
        }
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== "good-code") return send(400, { error: "invalid_grant" });
          return send(200, this.issue());
        }
        if (form.get("grant_type") === "refresh_token") {
          this.refreshCalls++;
          await new Promise((r) => setTimeout(r, 30)); // make races observable
          const rt = form.get("refresh_token") ?? "";
          if (!this.validRefresh.delete(rt)) return send(400, { error: "invalid_grant" });
          return send(200, this.issue());
        }
        return send(400, { error: "unsupported_grant_type" });
      }

      if (req.method === "GET" && url.pathname.startsWith("/v2/usercollection/")) {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!this.validAccess.has(token)) return send(401, { detail: "unauthorized" });
        const collection = url.pathname.split("/").pop()!;
        this.apiCalls.push({ path: collection, query: Object.fromEntries(url.searchParams) });
        return send(200, this.fixture(collection, url.searchParams));
      }
      send(404, {});
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  issue() {
    const n = ++this.counter;
    const access = `at-${n}`;
    const refresh = `rt-${n}`;
    this.validAccess.add(access);
    this.validRefresh.add(refresh);
    return { access_token: access, refresh_token: refresh, expires_in: this.expiresIn, token_type: "bearer", scope: "personal daily heartrate" };
  }

  fixture(collection: string, q: URLSearchParams) {
    switch (collection) {
      case "daily_sleep":
        // Two pages to exercise pagination. The extra day (11-08) is outside the requested range.
        if (!q.get("next_token")) {
          return { data: [{ id: "a", day: "2026-11-05", score: 80 }, { id: "b", day: "2026-11-06", score: 82 }], next_token: "page2" };
        }
        return { data: [{ id: "c", day: "2026-11-07", score: 75 }, { id: "d", day: "2026-11-08", score: 90 }], next_token: null };
      case "sleep":
        return {
          data: [
            {
              id: "s1", day: "2026-11-05", type: "long_sleep", average_hrv: 50, average_heart_rate: 55, lowest_heart_rate: 48,
              bedtime_start: "2026-11-04T23:00:00+00:00", bedtime_end: "2026-11-05T07:00:00+00:00",
              hrv: { interval: 300, items: [40, null, 60], timestamp: "2026-11-04T23:00:00+00:00" },
              heart_rate: { interval: 300, items: [55, 54], timestamp: "2026-11-04T23:00:00+00:00" },
              movement_30_sec: "1112", sleep_phase_5_min: "4421",
            },
            { id: "s2", day: "2026-11-06", type: "long_sleep", average_hrv: 70, average_heart_rate: 52, lowest_heart_rate: 46 },
            { id: "s3", day: "2026-11-06", type: "sleep", average_hrv: 20 },
          ],
          next_token: null,
        };
      case "daily_readiness":
        return { data: [{ day: "2026-11-05", score: 85, contributors: { hrv_balance: 77 } }], next_token: null };
      case "daily_activity":
        return { data: [{ day: "2026-11-05", score: 70, steps: 9000, class_5_min: "0011", met: { interval: 60, items: [1.1], timestamp: "x" } }], next_token: null };
      case "heartrate":
        return {
          data: [
            { bpm: 60, source: "awake", timestamp: "2026-11-05T10:01:00+00:00" },
            { bpm: 70, source: "awake", timestamp: "2026-11-05T10:31:00+00:00" },
            { bpm: 50, source: "rest", timestamp: "2026-11-05T11:05:00+00:00" },
          ],
          next_token: null,
        };
      default:
        return { data: [], next_token: null };
    }
  }

  async stop() {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export async function startApp(oura: MockOura, overrides: Partial<Record<string, string>> = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "oura-health-test-"));
  const config: Config = loadConfig({
    NODE_ENV: "test",
    PUBLIC_BASE_URL: "http://127.0.0.1:9999",
    OURA_CLIENT_ID: CLIENT_ID,
    OURA_CLIENT_SECRET: CLIENT_SECRET,
    OURA_AUTHORIZE_URL: `${oura.url}/oauth/authorize`,
    OURA_TOKEN_URL: `${oura.url}/oauth/token`,
    OURA_API_BASE_URL: oura.url,
    MCP_AUTH_TOKENS: MCP_TOKEN,
    ADMIN_PASSWORD,
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    DATA_DIR: dataDir,
    ...overrides,
  });
  const { app, auth } = createApp(config);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    auth,
    config,
    dataDir,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const basic = (password: string) => `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
