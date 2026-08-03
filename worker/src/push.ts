// Web Push (RFC 8291 aes128gcm payload + RFC 8292 VAPID) implemented on the
// Web Crypto API so the Worker can notify subscribed browsers even when the
// dashboard tab / installed app is fully closed.

export interface PushSub {
  endpoint: string;
  p256dh: string; // base64url user-agent public key (65 bytes, uncompressed)
  auth: string; // base64url auth secret (16 bytes)
}
export interface PushVapid {
  publicKey: string; // base64url uncompressed public key
  privateKey: string; // base64url PKCS#8 private key
  subject: string; // mailto: or https: contact
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

/** Encrypt the payload for one subscription per RFC 8291 (aes128gcm, single record). */
async function encryptPayload(sub: PushSub, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  const asKeys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // workers-types omits `public` on the ECDH derive algorithm; the runtime requires it.
  const ecdhAlgo = { name: "ECDH", public: uaKey } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlgo, asKeys.privateKey, 256));

  // ikm = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info"||0x00||ua||as, 32)
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = last-record padding delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record));

  // header: salt(16) || rs(4, =4096) || idlen(1)=65 || as_public(65)
  const header = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/** Build the VAPID Authorization header for a given push endpoint. */
async function vapidHeader(vapid: PushVapid, endpoint: string): Promise<string> {
  const url = new URL(endpoint);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(
    enc.encode(JSON.stringify({ aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 43200, sub: vapid.subject }))
  );
  const signingInput = `${header}.${payload}`;
  const pk = await crypto.subtle.importKey("pkcs8", b64urlToBytes(vapid.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pk, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${vapid.publicKey}`;
}

/**
 * Push a message to every subscription. Returns the endpoints that are gone
 * (404/410) so the caller can prune them.
 */
export async function sendPush(vapid: PushVapid, subs: PushSub[], msg: PushMessage): Promise<string[]> {
  const plaintext = enc.encode(JSON.stringify(msg));
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const body = await encryptPayload(sub, plaintext);
        const auth = await vapidHeader(vapid, sub.endpoint);
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Authorization: auth,
          },
          body,
        });
        if (res.status === 404 || res.status === 410) dead.push(sub.endpoint);
      } catch {
        /* transient failure — try again on the next event */
      }
    })
  );
  return dead;
}
