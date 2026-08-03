// Prints the current 6-digit TOTP code for local dev login.
// Usage: node scripts/code.js  (reads TOTP_SECRET from worker/.dev.vars)
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32decode(input) {
  let bits = "";
  for (const c of input.toUpperCase()) {
    const v = A.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let k = 0; k + 8 <= bits.length; k += 8) out.push(parseInt(bits.slice(k, k + 8), 2));
  return Buffer.from(out);
}
function totp(secret) {
  const key = b32decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const g = crypto.createHmac("sha1", key).update(buf).digest();
  const of = g[19] & 0xf;
  const bin =
    ((g[of] & 0x7f) << 24) | ((g[of + 1] & 0xff) << 16) | ((g[of + 2] & 0xff) << 8) | (g[of + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

const devVars = fs.readFileSync(path.join(__dirname, "..", ".dev.vars"), "utf8");
const secret = devVars.match(/^TOTP_SECRET=(.+)$/m)?.[1]?.trim();
if (!secret) {
  console.error("TOTP_SECRET not found in worker/.dev.vars");
  process.exit(1);
}
const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totp(secret)}  (valid ${secsLeft}s)`);
