import type { Config } from "./config.js";
import { NotConnectedError, type OuraAuth } from "./ouraAuth.js";

/** A user-facing error that is safe to return to Claude verbatim. */
export class OuraApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "OuraApiError";
  }
}

const MAX_PAGES = 20;

/**
 * Minimal, read-only Oura API v2 client. Only GET requests are ever made.
 * Handles pagination (`next_token`) and transparently refreshes the access
 * token once if Oura answers 401.
 */
export class OuraClient {
  constructor(
    private readonly config: Config,
    private readonly auth: OuraAuth,
  ) {}

  /** Fetch every page of a `/v2/usercollection/<collection>` endpoint. */
  async list<T = Record<string, unknown>>(
    collection: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const results: T[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = { ...params, ...(nextToken ? { next_token: nextToken } : {}) };
      const body = (await this.get(`/v2/usercollection/${collection}`, query)) as {
        data?: T[];
        next_token?: string | null;
      };
      results.push(...(body.data ?? []));
      nextToken = body.next_token ?? undefined;
      if (!nextToken) break;
    }
    return results;
  }

  private async get(pathname: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(pathname, this.config.OURA_API_BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let token = await this.auth.getAccessToken();
    let res = await this.fetchOnce(url, token);
    if (res.status === 401) {
      token = (await this.auth.refresh()).access_token;
      res = await this.fetchOnce(url, token);
    }

    if (res.ok) return res.json();

    switch (res.status) {
      case 401:
        throw new NotConnectedError(
          "Oura rejected the access token even after refreshing. The server owner must visit /oauth/start to reconnect.",
        );
      case 403:
        throw new OuraApiError(
          "Oura denied access (HTTP 403). The Oura account may lack an active membership, or the required scope was not granted when connecting.",
          403,
        );
      case 426:
        throw new OuraApiError("Oura requires the Oura app to be updated before data can be accessed (HTTP 426).", 426);
      case 429:
        throw new OuraApiError("Oura rate limit reached (HTTP 429). Try again in a few minutes.", 429);
      default:
        throw new OuraApiError(`Oura API returned HTTP ${res.status}.`, res.status);
    }
  }

  private fetchOnce(url: URL, token: string): Promise<Response> {
    return fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  }
}
