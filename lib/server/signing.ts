/**
 * Script tokens bind an execution request to a script this server generated.
 * Without them, `/api/execute` would run arbitrary client-supplied Python on
 * our CreateOS account. Tokens are `<expiry>.<base64url HMAC-SHA256>`.
 */

type Env = Record<string, string | undefined>;

const DOMAIN = "datafix-script-v1";
export const SCRIPT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Uses `DATAFIX_SIGNING_SECRET` when set. Otherwise it falls back to the OpenAI
 * key, which is already a high-entropy server-only secret; the domain prefix in
 * every signed message keeps the two uses separate.
 */
export function getSigningSecret(env: Env = process.env): string | null {
  return env.DATAFIX_SIGNING_SECRET || env.OPENAI_API_KEY || null;
}

const encoder = new TextEncoder();

function importKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function message(code: string, expiresAt: number) {
  return encoder.encode(`${DOMAIN}.${expiresAt}.${code}`);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function signScript(code: string, secret: string, now = Date.now()): Promise<string> {
  const expiresAt = now + SCRIPT_TOKEN_TTL_MS;
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), message(code, expiresAt));
  return `${expiresAt}.${toBase64Url(signature)}`;
}

export async function verifyScriptToken(code: string, token: string, secret: string, now = Date.now()): Promise<boolean> {
  const [expiry, encoded, extra] = token.split(".");
  const expiresAt = Number(expiry);
  if (extra !== undefined || !Number.isSafeInteger(expiresAt) || expiresAt < now || !encoded) return false;
  const signature = fromBase64Url(encoded);
  if (!signature) return false;
  // `subtle.verify` compares in constant time.
  return crypto.subtle.verify("HMAC", await importKey(secret), signature, message(code, expiresAt));
}
