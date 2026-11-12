import { loadConfig, redirectUri } from "./config.js";
import { createApp, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * In the container we start as root only so the entrypoint can fix volume
 * ownership. Before reading any secret or opening a port, permanently switch
 * to an unprivileged user.
 */
function dropPrivileges() {
  const uid = process.env.RUN_AS_UID;
  const gid = process.env.RUN_AS_GID;
  if (!uid || !gid || typeof process.getuid !== "function" || process.getuid() !== 0) return;
  process.setgroups?.([]);
  process.setgid!(Number(gid));
  process.setuid!(Number(uid));
  if (process.getuid() === 0) throw new Error("Failed to drop root privileges");
}
dropPrivileges();

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  console.error("\nSee .env.example for every setting. Run `npm run gen-secrets` to generate secure secrets.");
  process.exit(1);
}

const { app, auth } = createApp(config);

const server = app.listen(config.PORT, config.HOST, async () => {
  const status = await auth.status().catch(() => ({ connected: false }));
  console.log(`${SERVER_NAME} v${SERVER_VERSION} listening on http://${config.HOST}:${config.PORT}`);
  console.log(`  MCP endpoint:      ${new URL("/mcp", config.PUBLIC_BASE_URL)}`);
  console.log(`  OAuth redirect URI ${redirectUri(config)}  (register this in your Oura app)`);
  console.log(`  Oura connected:    ${status.connected ? "yes" : `no — visit ${new URL("/oauth/start", config.PUBLIC_BASE_URL)}`}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
