import { randomBytes } from "node:crypto";
import { redirectUri, type Config } from "./config.js";
import type { OuraTokens, TokenStore } from "./tokenStore.js";

/** Thrown when there is no usable Oura connection and a human must reconnect. */
export class NotConnectedError extends Error {
  constructor(message = "Oura account is not connected. The server owner must visit /oauth/start to connect it.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry
const STATE_TTL_MS = 10 * 60 * 1000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export class OuraAuth {
  /** One-time OAuth `state` values -> expiry. Protects the callback from CSRF. */
  private readonly pendingStates = new Map<string, number>();
  /** Single-flight refresh: concurrent callers share one refresh request. */
  private refreshing: Promise<OuraTokens> | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: TokenStore,
  ) {}

  /** Build the Oura consent URL and remember the state we issued. */
  createAuthorizeUrl(): string {
    this.pruneStates();
    const state = randomBytes(32).toString("base64url");
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    const url = new URL(this.config.OURA_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.OURA_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri(this.config));
    url.searchParams.set("scope", this.config.OURA_SCOPES);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** Validate and consume a state value (single use). */
  consumeState(state: string | undefined): boolean {
    this.pruneStates();
    if (!state) return false;
    const expiry = this.pendingStates.get(state);
    if (expiry === undefined) return false;
    this.pendingStates.delete(state);
    return expiry > Date.now();
  }

  /** Exchange the authorization code from the callback for tokens and store them. */
  async exchangeCode(code: string): Promise<OuraTokens> {
    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(this.config),
    });
    if (!tokens.refresh_token) {
      throw new Error("Oura did not return a refresh token");
    }
    const stored = this.toStored(tokens, tokens.refresh_token);
    await this.store.save(stored);
    return stored;
  }

  /** Return a non-expired access token, refreshing if needed. */
  async getAccessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new NotConnectedError();
    if (tokens.expires_at - REFRESH_SKEW_MS > Date.now()) return tokens.access_token;
    return (await this.refresh()).access_token;
  }

  /**
   * Refresh the access token. Oura refresh tokens are single-use, so we
   * (1) never run two refreshes at once and (2) save the new refresh token
   * before anyone uses the new access token.
   */
  async refresh(): Promise<OuraTokens> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async status(): Promise<{ connected: boolean; expires_at?: string; scope?: string; updated_at?: string }> {
    const tokens = await this.store.load();
    if (!tokens) return { connected: false };
    return {
      connected: true,
      expires_at: new Date(tokens.expires_at).toISOString(),
      scope: tokens.scope,
      updated_at: new Date(tokens.updated_at).toISOString(),
    };
  }

  private async doRefresh(): Promise<OuraTokens> {
    const current = await this.store.load();
    if (!current) throw new NotConnectedError();
    let response: TokenResponse;
    try {
      response = await this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: current.refresh_token,
      });
    } catch (err) {
      if (err instanceof OAuthGrantError) {
        // The refresh token was revoked or already used: a human must reconnect.
        throw new NotConnectedError(
          "Oura authorization has expired or was revoked. The server owner must visit /oauth/start to reconnect.",
        );
      }
      throw err;
    }
    // If Oura ever omits a new refresh token, keep the existing one.
    const stored = this.toStored(response, response.refresh_token ?? current.refresh_token);
    await this.store.save(stored);
    return stored;
  }

  private toStored(t: TokenResponse, refreshToken: string): OuraTokens {
    return {
      access_token: t.access_token,
      refresh_token: refreshToken,
      // Default to 1 day if Oura doesn't say; we refresh on 401 anyway.
      expires_at: Date.now() + (t.expires_in ?? 86_400) * 1000,
      scope: t.scope,
      token_type: t.token_type,
      updated_at: Date.now(),
    };
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({
      ...params,
      client_id: this.config.OURA_CLIENT_ID,
      client_secret: this.config.OURA_CLIENT_SECRET,
    });
    const res = await fetch(this.config.OURA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Never log the response body: it may echo credentials.
      if (res.status === 400 || res.status === 401) throw new OAuthGrantError(res.status);
      throw new Error(`Oura token endpoint returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as Partial<TokenResponse>;
    if (typeof json.access_token !== "string" || !json.access_token) {
      throw new Error("Oura token endpoint returned no access_token");
    }
    return json as TokenResponse;
  }

  private pruneStates(): void {
    const now = Date.now();
    for (const [state, expiry] of this.pendingStates) {
      if (expiry <= now) this.pendingStates.delete(state);
    }
  }
}

class OAuthGrantError extends Error {
  constructor(public readonly status: number) {
    super(`Oura rejected the OAuth grant (HTTP ${status})`);
    this.name = "OAuthGrantError";
  }
}
