import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption. GCM both hides the data and detects
 * tampering: if anyone edits the encrypted file, decryption throws.
 */
const AAD = Buffer.from("oura-health:tokens:v1");

export interface EncryptedBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  if (blob.v !== 1) throw new Error("Unsupported encrypted blob version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time string comparison. Hashing first makes both inputs the same
 * length, so neither the content nor the length of a secret leaks through
 * response timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
