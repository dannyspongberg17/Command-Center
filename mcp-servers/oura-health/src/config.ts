import { z } from "zod";

/**
 * All configuration comes from environment variables (never from files that
 * get committed). The server refuses to start if anything required is
 * missing or too weak, so a misconfigured deploy fails loudly instead of
 * running insecurely.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Where the HTTP server listens. Locally we bind to 127.0.0.1 so nothing
  // else on your network can reach it; in a container we bind to 0.0.0.0.
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  // The public base URL of this server, e.g. https://oura-health.fly.dev
  // Used to build the OAuth redirect URI registered with Oura.
  PUBLIC_BASE_URL: z.url(),

  // Oura developer application credentials (cloud.ouraring.com/oauth/applications)
  OURA_CLIENT_ID: z.string().min(1, "OURA_CLIENT_ID is required"),
  OURA_CLIENT_SECRET: z.string().min(1, "OURA_CLIENT_SECRET is required"),
  // Space-separated Oura scopes. "daily" covers sleep/readiness/activity
  // (and the HRV inside sleep sessions); "heartrate" covers heart rate.
  OURA_SCOPES: z.string().default("personal daily heartrate"),

  // Endpoints - only overridden by the automated tests.
  OURA_AUTHORIZE_URL: z.url().default("https://cloud.ouraring.com/oauth/authorize"),
  OURA_TOKEN_URL: z.url().default("https://api.ouraring.com/oauth/token"),
  OURA_API_BASE_URL: z.url().default("https://api.ouraring.com"),

  // Bearer token(s) that Claude must present to call /mcp. Comma-separated
  // so you can rotate: add the new one, update Claude, remove the old one.
  MCP_AUTH_TOKENS: z
    .string()
    .min(1, "MCP_AUTH_TOKENS is required")
    .transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.string().min(32, "each MCP auth token must be at least 32 characters"))
        .min(1),
    ),

  // Password protecting the one-time "connect my Oura account" page.
  ADMIN_PASSWORD: z.string().min(16, "ADMIN_PASSWORD must be at least 16 characters"),

  // 32-byte key (base64) used to encrypt Oura tokens at rest.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .transform((s) => Buffer.from(s, "base64"))
    .refine((b) => b.length === 32, "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run `npm run gen-secrets`)"),

  // Directory for the encrypted token file. Must be persistent storage in
  // production (Oura refresh tokens are single-use, so losing the latest
  // one means reconnecting).
  DATA_DIR: z.string().default("./data"),

  // Set to "true" when running behind a reverse proxy / platform load
  // balancer (Fly.io, Render, Railway...) so client IPs are read correctly.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const config = parsed.data;

  if (config.NODE_ENV === "production" && !config.PUBLIC_BASE_URL.startsWith("https://")) {
    throw new Error("Invalid configuration:\n  - PUBLIC_BASE_URL must use https:// in production");
  }
  return config;
}

export function redirectUri(config: Config): string {
  return new URL("/oauth/callback", config.PUBLIC_BASE_URL).toString();
}
