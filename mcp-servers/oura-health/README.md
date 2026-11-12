# oura-health — a private MCP server for your Oura Ring

This small web server lets your **Dannys Health** agent in the Claude Console
read your Oura data (sleep, readiness, activity, HRV and heart rate). It is
**read-only**: it can never change anything in your Oura account.

```
 Claude Console agent ──(HTTPS + secret token)──▶ oura-health server ──(OAuth2)──▶ Oura API v2
   "Dannys Health"                               (runs on Fly.io)               api.ouraring.com
```

## How it keeps your health data private

| Risk | What protects you |
|---|---|
| A stranger finds your server URL and asks for data | `/mcp` refuses every request without the secret **MCP auth token**. Only Claude (through a Console *vault*) has it. Repeated wrong guesses are rate-limited. |
| Someone links *their* Oura account, or tricks you into linking yours | The "connect Oura" page needs your **admin password**. The OAuth callback only accepts a single-use, unguessable `state` value that this page creates. |
| Oura tokens leak from the server's disk | They are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`, which lives only in the host's secret store. |
| Secrets end up on GitHub | Secrets are only read from environment variables. `.env` and `data/` are git-ignored, and nothing secret is in `fly.toml`. |
| Data intercepted in transit | Production requires `https://` and HSTS. Every response is marked `no-store`, so it isn't cached. |
| Data ends up in logs | The server never logs request or response bodies, only error types. |
| Container break-out | The server drops from root to an unprivileged user before reading any secret. |

**Token refresh.** Oura access tokens expire, and each refresh token can be used only **once**. The server
refreshes about 5 minutes before expiry (or right away if Oura answers
`401`). It makes sure only one refresh runs at a time, and it saves the new
refresh token to disk before using the new access token. That's why production
needs a **persistent disk** (a Fly volume). If you revoke access in the Oura
app, the tools tell Claude that you need to reconnect.

## The tools Claude gets

| Tool | What it returns |
|---|---|
| `get_daily_sleep` | Daily sleep score and its contributors |
| `get_sleep_sessions` | Each sleep period: bedtimes, deep/REM/light durations, efficiency, HR, HRV. Optional 5-minute series. |
| `get_daily_readiness` | Readiness score, temperature deviation, contributors (incl. HRV balance) |
| `get_daily_activity` | Activity score, steps, calories, activity time. Optional 5-minute series. |
| `get_hrv` | Nightly average HRV (ms), resting HR, HRV-balance score, and a mean/min/max summary. Optional 5-minute HRV samples. |
| `get_heart_rate` | Heart rate between two times, grouped as raw, 5-minute, hourly or daily buckets |

Dates are `YYYY-MM-DD` and the end date is inclusive. The default is the last 7 days. Daily
tools allow up to 90 days per call (14 with samples). Heart rate allows 7 days (24 h raw).

---

## Step 0 — What you need

- **Node.js 22+** (`node -v`) for running it on your computer
- Your **Oura developer application** at
  <https://cloud.ouraring.com/oauth/applications>, with its **Client ID** and **Client Secret**
- For deploying: a free **Fly.io** account (<https://fly.io>; a card is required)

## Step 1 — Configure your Oura application

In your Oura application's settings, add these **Redirect URIs** (the
addresses Oura sends you back to after you click "Allow"):

- `http://localhost:8080/oauth/callback` (for local testing)
- `https://<your-app-name>.fly.dev/oauth/callback` (add this in Step 4, once you've picked a name)

They must match exactly, with no trailing slash. Also make sure the app is allowed
the scopes in `OURA_SCOPES` (default `personal daily heartrate`). If Oura
reports an invalid scope, change `OURA_SCOPES` to match what your app lists.

## Step 2 — Run it on your computer

```bash
cd mcp-servers/oura-health
npm install
```

Generate three random secrets. They are printed to your screen only. Save them in a
password manager:

```bash
npm run gen-secrets
```

Create your private settings file and fill it in (`OURA_CLIENT_ID`,
`OURA_CLIENT_SECRET`, plus the three generated values):

```bash
cp .env.example .env
```

`.env` is git-ignored, so it never gets committed. Now start the server:

```bash
npm run dev
```

You should see `listening on http://127.0.0.1:8080`.

**Connect your Oura account:** open <http://localhost:8080/oauth/start>.
Your browser asks for a login. Type any username and your `ADMIN_PASSWORD`. You
are sent to Oura. Click **Allow** and you land on "Oura connected ✔".
The encrypted tokens are now in `./data/`.

**Check that it works** (in a second terminal; replace `YOUR_TOKEN` with your
`MCP_AUTH_TOKENS` value):

```bash
curl -s -X POST http://localhost:8080/mcp -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_daily_readiness","arguments":{}}}'
```

You should get your last 7 days of readiness. The same command without the
`Authorization` header must return `401 Unauthorized`. That's the lock working.

If you prefer a visual tester, run `npx @modelcontextprotocol/inspector` and choose
"Streamable HTTP" with URL `http://localhost:8080/mcp`. Add the header
`Authorization: Bearer YOUR_TOKEN`.

> Claude Console can't reach `localhost`. Local testing is for you; Claude
> connects to the deployed HTTPS URL from Step 4.

## Step 3 — Run the automated tests

```bash
npm test
```

The tests start a **fake Oura server**, so they never touch your real account. They check
the auth locks, the OAuth flow, encryption at rest, token refresh (including
5 simultaneous requests causing exactly one refresh), pagination and every tool.

## Step 4 — Deploy to an HTTPS URL (Fly.io)

Fly.io runs the included `Dockerfile`, gives you `https://<name>.fly.dev`
with a TLS certificate, and provides the persistent disk the tokens need.

1. **Install the Fly CLI and log in**. Install instructions are at <https://fly.io/docs/flyctl/install/>. Then:

   ```bash
   fly auth login
   ```

2. **Pick an app name** (letters, digits, dashes; it must be globally unique), e.g.
   `dannys-oura-health`. In `fly.toml`, replace both `oura-health-CHANGE-ME`
   with it. Optionally change `primary_region` (e.g. `sjc`, `lhr`).

3. **Create the app** (from `mcp-servers/oura-health`):

   ```bash
   fly apps create dannys-oura-health
   ```

4. **Create the 1 GB encrypted disk** for tokens (same region as `fly.toml`):

   ```bash
   fly volumes create oura_data --size 1 --region iad --app dannys-oura-health
   ```

5. **Store secrets** in Fly's encrypted secret store, never in files. Use the
   **same** values from Step 2, or new ones from `npm run gen-secrets`:

   ```bash
   fly secrets set --app dannys-oura-health OURA_CLIENT_ID="..." OURA_CLIENT_SECRET="..." MCP_AUTH_TOKENS="..." ADMIN_PASSWORD="..." TOKEN_ENCRYPTION_KEY="..."
   ```

   Tip: start the line with a space, which keeps it out of shell history in most setups. Or run
   `fly secrets import` and paste `KEY=value` lines.

6. **Deploy**:

   ```bash
   fly deploy --app dannys-oura-health --ha=false
   ```

   `--ha=false` keeps exactly **one** machine, because the volume can only attach to one.

7. **Add the production redirect URI** in your Oura app:
   `https://dannys-oura-health.fly.dev/oauth/callback`

8. **Connect Oura in production**: open
   `https://dannys-oura-health.fly.dev/oauth/start`, log in with your admin
   password, and click Allow. Check with `/oauth/status` (also password protected).

9. **Verify the lock** (should print `401`):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://dannys-oura-health.fly.dev/mcp
   ```

Your MCP server URL is **`https://dannys-oura-health.fly.dev/mcp`**.

Other hosts work too (Railway, Render with a disk, or any Docker host behind HTTPS).
You need three things: run the Dockerfile, mount a persistent disk at `/data`, set the env vars, and
set `TRUST_PROXY=true` behind a load balancer.

## Step 5 — Connect it to "Dannys Health" in Claude Console

Console agents keep server **addresses** on the agent and **secrets** in a
**vault**. That way the token never sits in the agent's config, and the agent's
sandbox can't read it.

1. **Add the MCP server to the agent.** Open the *Dannys Health* agent and add a
   remote MCP server:
   - **Name:** `oura-health`
   - **URL:** `https://dannys-oura-health.fly.dev/mcp`

   Enable its toolset (`mcp_toolset` for `oura-health`). The default permission
   policy for MCP tools is *always ask*: you approve each call. You can set it
   to *always allow* later, since every tool is read-only.

2. **Create a vault credential with your token.** In Console → *Vaults*, create a vault
   (e.g. `dannys-health`) and add a credential of type **bearer token**
   (`static_bearer`):
   - **MCP server URL:** exactly `https://dannys-oura-health.fly.dev/mcp`
   - **Token:** your `MCP_AUTH_TOKENS` value

   Equivalent API shape:

   ```json
   { "display_name": "oura-health", "auth": { "type": "static_bearer", "mcp_server_url": "https://dannys-oura-health.fly.dev/mcp", "token": "<MCP_AUTH_TOKENS value>" } }
   ```

   The vault matches the credential to the server **by URL**. If the path,
   subdomain or port differs, it isn't sent and you'll see 401 errors.

3. **Attach the vault when starting a session** (`vault_ids`, or pick the vault
   in the Console's session/test panel). Then ask: *"How has my HRV trended this
   week compared to my readiness?"*

## Day-to-day maintenance

- **Logs:** `fly logs --app dannys-oura-health`. They never contain your health data.
- **Rotate the MCP token:**
  1. Set `MCP_AUTH_TOKENS="old,new"`.
  2. Update the vault credential to `new`.
  3. Set `MCP_AUTH_TOKENS="new"`.
- **Reconnect Oura** (after revoking it in the Oura app, or if tools say "reconnect"): visit `/oauth/start` again.
- **Disconnect completely:** revoke the app in your Oura account settings, then
  `fly volumes destroy` or `fly apps destroy dannys-oura-health`.
- **Updates:** change code, run `npm test`, then `fly deploy`.
- **Don't lose `TOKEN_ENCRYPTION_KEY`.** If you change it, the stored tokens can't be read, and you just reconnect Oura.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with `Invalid configuration` | The message lists each missing or weak setting. Compare with `.env.example`. |
| Oura says *invalid redirect_uri* | The redirect URI in the Oura app must exactly equal `<PUBLIC_BASE_URL>/oauth/callback`. |
| Oura says *invalid scope* | Edit `OURA_SCOPES` to match the scopes your Oura app allows. |
| Callback says "Link expired or invalid" | Links last 10 minutes and work once. Restart from `/oauth/start`. |
| Claude gets 401 | The vault credential URL must exactly match the agent's MCP URL, and the token must match `MCP_AUTH_TOKENS`. |
| Tool says HTTP 403 | Oura needs an active membership, or a scope wasn't granted. Reconnect and approve all scopes. |
| First request is slow | Fly stops idle machines. The first request wakes it in a few seconds. Set `min_machines_running = 1` to avoid this (small extra cost). |
