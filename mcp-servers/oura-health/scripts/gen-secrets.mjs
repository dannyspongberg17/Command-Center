// Prints freshly generated secrets for your .env (or `fly secrets set`).
// Nothing is written to disk; copy the values somewhere safe (a password manager).
import { randomBytes } from "node:crypto";

console.log(`MCP_AUTH_TOKENS=${randomBytes(32).toString("base64url")}`);
console.log(`ADMIN_PASSWORD=${randomBytes(18).toString("base64url")}`);
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
