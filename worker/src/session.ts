const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message).buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

export async function createSessionToken(sessionSecret: string, epoch: number): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, epoch });
  const payloadB64 = b64url(new TextEncoder().encode(payload));
  const sig = await hmacSha256(sessionSecret, payloadB64);
  return `${payloadB64}.${b64url(sig)}`;
}

/** Returns the token's session epoch if the signature + expiry are valid, else null. */
export async function verifySessionToken(token: string | null, sessionSecret: string): Promise<number | null> {
  if (!token) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = b64url(await hmacSha256(sessionSecret, payloadB64));
  if (expectedSig !== sigB64) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return typeof payload.epoch === "number" ? payload.epoch : 0;
  } catch {
    return null;
  }
}
