import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decrypt, encrypt, type EncryptedBlob } from "./crypto.js";

export interface OuraTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds when the access token expires. */
  expires_at: number;
  scope?: string;
  token_type?: string;
  updated_at: number;
}

export interface TokenStore {
  load(): Promise<OuraTokens | null>;
  save(tokens: OuraTokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Stores Oura OAuth tokens in a single AES-256-GCM-encrypted file.
 * Writes are atomic (write temp file, then rename) so a crash mid-write can
 * never leave a half-written file — important because Oura refresh tokens
 * are single-use and the newest one must never be lost.
 */
export class EncryptedFileTokenStore implements TokenStore {
  private readonly file: string;

  constructor(dataDir: string, private readonly key: Buffer) {
    this.file = path.resolve(dataDir, "oura-tokens.enc.json");
  }

  async load(): Promise<OuraTokens | null> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const blob = JSON.parse(raw) as EncryptedBlob;
    return JSON.parse(decrypt(blob, this.key)) as OuraTokens;
  }

  async save(tokens: OuraTokens): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(encrypt(JSON.stringify(tokens), this.key)), {
      mode: 0o600,
    });
    await rename(tmp, this.file);
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
