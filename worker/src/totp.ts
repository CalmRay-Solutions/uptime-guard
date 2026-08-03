const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

async function totpAt(secretBase32: string, counter: number): Promise<string> {
  const key = base32Decode(secretBase32);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const digest = await hmacSha1(key, msg);
  const offset = digest[19] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Verifies a 6-digit TOTP code, tolerating +/- one 30s step of clock drift. */
export async function verifyTotp(secretBase32: string, code: string, step = 30): Promise<boolean> {
  const cleanCode = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const counter = Math.floor(Date.now() / 1000 / step);
  for (const delta of [0, -1, 1]) {
    const candidate = await totpAt(secretBase32, counter + delta);
    if (timingSafeEqual(candidate, cleanCode)) return true;
  }
  return false;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
