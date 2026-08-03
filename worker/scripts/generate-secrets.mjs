import crypto from "node:crypto";
import qrcodeTerminal from "qrcode-terminal";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomBase32(byteLen = 20) {
  const bytes = crypto.randomBytes(byteLen);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

const accountLabel = process.argv[2] || "me";
const totpSecret = randomBase32();
const sessionSecret = crypto.randomBytes(32).toString("hex");
const otpauthUri = `otpauth://totp/UptimeGuard:${encodeURIComponent(accountLabel)}?secret=${totpSecret}&issuer=UptimeGuard&algorithm=SHA1&digits=6&period=30`;

console.log("\n=== Uptime Guard: authenticator setup ===\n");
console.log("Scan this QR code with Google Authenticator / Authy / 1Password:\n");
qrcodeTerminal.generate(otpauthUri, { small: true }, (qr) => console.log(qr));

console.log("Or add it manually with this secret:");
console.log(`  ${totpSecret}\n`);

console.log("Set these as Worker secrets:\n");
console.log(`  wrangler secret put TOTP_SECRET`);
console.log(`  -> paste: ${totpSecret}\n`);
console.log(`  wrangler secret put SESSION_SECRET`);
console.log(`  -> paste: ${sessionSecret}\n`);
console.log(`  wrangler secret put PASSWORD`);
console.log(`  -> paste: <a password you choose>\n`);

console.log("For local dev, put the same three values in worker/.dev.vars instead.\n");
