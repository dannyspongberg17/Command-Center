import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { safeEqual } from "./crypto.js";
import { OuraAuth } from "./ouraAuth.js";
import { OuraClient } from "./ouraClient.js";
import { EncryptedFileTokenStore, type TokenStore } from "./tokenStore.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "oura-health";
export const SERVER_VERSION = "1.0.0";

export function createApp(config: Config, store: TokenStore = new EncryptedFileTokenStore(config.DATA_DIR, config.TOKEN_ENCRYPTION_KEY)) {
  const auth = new OuraAuth(config, store);
  const client = new OuraClient(config, auth);
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  // Conservative security headers on every response. Health data must never
  // be cached by browsers or intermediaries.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    if (config.PUBLIC_BASE_URL.startsWith("https://")) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // Too many *failed* auth attempts from one IP -> blocked for a while.
  const failedAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_failed_attempts" },
  });
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "rate_limited" },
  });

  // --- Public, data-free liveness check -----------------------------------
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // --- Admin: connect your Oura account (password protected) ---------------
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    let password = "";
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      password = decoded.slice(decoded.indexOf(":") + 1);
    }
    if (password && safeEqual(password, config.ADMIN_PASSWORD)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="oura-health admin", charset="UTF-8"');
    res.status(401).send("Authentication required");
  };

  app.get("/oauth/start", failedAuthLimiter, requireAdmin, (_req, res) => {
    res.redirect(302, auth.createAuthorizeUrl());
  });

  app.get("/oauth/status", failedAuthLimiter, requireAdmin, async (_req, res, next) => {
    try {
      res.json(await auth.status());
    } catch (err) {
      next(err);
    }
  });

  // Oura redirects the browser here after you approve access. It is protected
  // by the single-use, unguessable `state` value that only /oauth/start (behind
  // the admin password) can issue.
  app.get("/oauth/callback", generalLimiter, async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (!auth.consumeState(state)) {
      res.status(400).send(page("Link expired or invalid", "Please start again from /oauth/start."));
      return;
    }
    if (req.query.error || !code) {
      res.status(400).send(page("Oura access was not granted", "You can try again from /oauth/start."));
      return;
    }
    try {
      await auth.exchangeCode(code);
      res.send(page("Oura connected ✔", "Your Oura account is connected. You can close this tab."));
    } catch (err) {
      console.error("[oura-health] OAuth code exchange failed:", err instanceof Error ? err.message : "unknown");
      res.status(502).send(page("Could not connect to Oura", "The code exchange failed. Check the server logs and try again."));
    }
  });

  // --- MCP endpoint (bearer-token protected) -------------------------------
  const requireBearer = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const presented = match?.[1]?.trim() ?? "";
    // Compare against every configured token (no early exit) in constant time.
    let valid = false;
    for (const t of config.MCP_AUTH_TOKENS) valid = safeEqual(presented, t) || valid;
    if (presented && valid) return next();
    res.setHeader("WWW-Authenticate", 'Bearer realm="oura-health"');
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };

  app.post(
    "/mcp",
    failedAuthLimiter,
    generalLimiter,
    requireBearer,
    express.json({ limit: "256kb" }),
    async (req, res) => {
      // Stateless mode: a fresh MCP server + transport per request. Nothing
      // about one request (or its health data) lingers in memory afterwards.
      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
      registerTools(server, client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error("[oura-health] MCP request failed:", err instanceof Error ? err.message : "unknown");
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
        }
      }
    },
  );

  // Stateless server: no server-initiated streams or sessions to delete.
  app.all("/mcp", failedAuthLimiter, requireBearer, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[oura-health] unhandled error:", err instanceof Error ? err.message : "unknown");
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });

  return { app, auth, client };
}

function page(title: string, body: string): string {
  // Only fixed strings are interpolated here — never request input.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p></body></html>`;
}
