import { connect } from "cloudflare:sockets";

/**
 * Reads the leaf certificate's notAfter date from a TLS server without any
 * platform cert API: we speak a minimal TLS 1.2 handshake over a raw socket,
 * read the server's cleartext Certificate message, and parse the DER.
 *
 * Requires the server to negotiate TLS 1.2 (we do not advertise 1.3, whose
 * Certificate message is encrypted). Virtually all public TLS servers do.
 */
export async function getCertExpiry(
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ notAfter: number; responseTime: number }> {
  const startedAt = Date.now();
  const socket = connect({ hostname: host, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("TLS handshake timed out")), timeoutMs)
  );

  try {
    await Promise.race([writer.write(buildClientHello(host)), timeout]);

    let state: HsState = { raw: new Uint8Array(0), handshake: new Uint8Array(0) };

    while (true) {
      // Consume any complete records we have, then look for the Certificate message.
      state = drainHandshakeRecords(state);
      const der = findLeafCertificate(state.handshake);
      if (der) {
        const notAfter = parseNotAfter(der);
        if (!Number.isFinite(notAfter)) throw new Error("could not parse certificate date");
        return { notAfter, responseTime: Date.now() - startedAt };
      }

      const { value, done } = (await Promise.race([reader.read(), timeout])) as ReadableStreamReadResult<Uint8Array>;
      if (done || !value) throw new Error("connection closed before certificate");
      state = { ...state, raw: concat(state.raw, value) };
      if (state.raw.length > 65535 * 4) throw new Error("certificate not found in handshake");
    }
  } finally {
    await writer.close().catch(() => {});
    await socket.close().catch(() => {});
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

interface HsState {
  raw: Uint8Array;
  handshake: Uint8Array;
}

/**
 * Consumes whole TLS records from state.raw, appending handshake-record payloads
 * to state.handshake. TLS alerts abort. Leftover partial record stays in raw.
 */
function drainHandshakeRecords(state: HsState): HsState {
  const { raw } = state;
  let offset = 0;
  let hs = state.handshake;
  while (raw.length - offset >= 5) {
    const type = raw[offset];
    const len = (raw[offset + 3] << 8) | raw[offset + 4];
    if (raw.length - offset - 5 < len) break; // incomplete record
    const payload = raw.subarray(offset + 5, offset + 5 + len);
    if (type === 21) throw new Error(`TLS alert (level ${payload[0]}, desc ${payload[1]})`);
    if (type === 22) hs = concat(hs, payload);
    offset += 5 + len;
  }
  return { raw: raw.subarray(offset), handshake: hs };
}

/** Walks reassembled handshake messages and returns the leaf cert DER, if present. */
function findLeafCertificate(hs: Uint8Array): Uint8Array | null {
  let p = 0;
  while (p + 4 <= hs.length) {
    const msgType = hs[p];
    const msgLen = (hs[p + 1] << 16) | (hs[p + 2] << 8) | hs[p + 3];
    if (p + 4 + msgLen > hs.length) break; // incomplete message
    const body = hs.subarray(p + 4, p + 4 + msgLen);
    if (msgType === 11) {
      // Certificate: certs_len(3) then repeated [cert_len(3) + der]
      const certsLen = (body[0] << 16) | (body[1] << 8) | body[2];
      if (certsLen >= 3) {
        const certLen = (body[3] << 16) | (body[4] << 8) | body[5];
        return body.subarray(6, 6 + certLen);
      }
      return null;
    }
    p += 4 + msgLen;
  }
  return null;
}

function buildClientHello(host: string): Uint8Array {
  const rand = new Uint8Array(32);
  crypto.getRandomValues(rand);

  const cipherSuites = new Uint8Array([
    0xc0, 0x2f, 0xc0, 0x30, 0xc0, 0x2b, 0xc0, 0x2c, // ECDHE-RSA/ECDSA AES-GCM
    0xc0, 0x13, 0xc0, 0x14, // ECDHE-RSA AES-CBC
    0x00, 0x9c, 0x00, 0x9d, // RSA AES-GCM
    0x00, 0x2f, 0x00, 0x35, // RSA AES-CBC
  ]);

  const nameBytes = new TextEncoder().encode(host);
  const sni = concat(
    new Uint8Array([0x00, 0x00]), // extension type: server_name
    withLen16(
      concat(
        withLen16(concat(new Uint8Array([0x00]), withLen16(nameBytes))), // server_name_list -> entry
        new Uint8Array(0)
      )
    )
  );
  const supportedGroups = new Uint8Array([
    0x00, 0x0a, 0x00, 0x08, 0x00, 0x06, 0x00, 0x17, 0x00, 0x18, 0x00, 0x1d, // secp256r1, secp384r1, x25519
  ]);
  const ecPointFormats = new Uint8Array([0x00, 0x0b, 0x00, 0x02, 0x01, 0x00]);
  const sigAlgs = new Uint8Array([
    0x00, 0x0d, 0x00, 0x0c, 0x00, 0x0a, 0x04, 0x01, 0x04, 0x03, 0x05, 0x01, 0x02, 0x01, 0x02, 0x03,
  ]);
  const extensions = concat(concat(sni, supportedGroups), concat(ecPointFormats, sigAlgs));

  const body = concat(
    concat(
      new Uint8Array([0x03, 0x03]), // client_version TLS 1.2
      rand
    ),
    concat(
      concat(
        new Uint8Array([0x00]), // session_id length
        concat(withLen16(cipherSuites), new Uint8Array([0x01, 0x00])) // ciphers + compression(null)
      ),
      withLen16(extensions)
    )
  );

  const handshake = concat(new Uint8Array([0x01, ...len24(body.length)]), body); // ClientHello
  const record = concat(new Uint8Array([0x16, 0x03, 0x01, ...len16(handshake.length)]), handshake);
  return record;
}

function withLen16(b: Uint8Array): Uint8Array {
  return concat(new Uint8Array(len16(b.length)), b);
}
function len16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function len24(n: number): number[] {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Minimal DER walk: outer cert SEQ -> tbs SEQ -> validity SEQ -> notAfter Time. */
function parseNotAfter(der: Uint8Array): number {
  const reader = new DerReader(der);
  reader.expect(0x30); // Certificate ::= SEQUENCE { tbsCertificate, sigAlg, sigValue }
  const cert = reader.readSeqInto(); // into Certificate
  const tbs = cert.readSeqInto(); // into tbsCertificate
  // tbs children: [0]version?, serial, sigAlg, issuer, validity, ...
  if (tbs.peek() === 0xa0) tbs.skip(); // optional version
  tbs.skip(); // serialNumber
  tbs.skip(); // signature AlgorithmIdentifier
  tbs.skip(); // issuer
  const validity = tbs.readSeqInto(); // validity
  validity.skip(); // notBefore
  const { tag, value } = validity.readTLV(); // notAfter
  return parseAsn1Time(tag, value);
}

class DerReader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}
  peek(): number {
    return this.buf[this.pos];
  }
  private readLen(): number {
    let len = this.buf[this.pos++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | this.buf[this.pos++];
    }
    return len;
  }
  readTLV(): { tag: number; value: Uint8Array } {
    const tag = this.buf[this.pos++];
    const len = this.readLen();
    const value = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return { tag, value };
  }
  expect(tag: number): void {
    if (this.buf[this.pos] !== tag) throw new Error(`DER: expected tag ${tag}, got ${this.buf[this.pos]}`);
  }
  readSeqInto(): DerReader {
    const { value } = this.readTLV();
    return new DerReader(value);
  }
  skip(): void {
    this.readTLV();
  }
}

function parseAsn1Time(tag: number, value: Uint8Array): number {
  const s = new TextDecoder().decode(value);
  // UTCTime (0x17): YYMMDDHHMMSSZ ; GeneralizedTime (0x18): YYYYMMDDHHMMSSZ
  let year: number, rest: string;
  if (tag === 0x17) {
    const yy = parseInt(s.slice(0, 2), 10);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    rest = s.slice(2);
  } else {
    year = parseInt(s.slice(0, 4), 10);
    rest = s.slice(4);
  }
  const mo = parseInt(rest.slice(0, 2), 10);
  const da = parseInt(rest.slice(2, 4), 10);
  const hh = parseInt(rest.slice(4, 6), 10);
  const mi = parseInt(rest.slice(6, 8), 10);
  const ss = parseInt(rest.slice(8, 10) || "0", 10);
  return Date.UTC(year, mo - 1, da, hh, mi, ss);
}
