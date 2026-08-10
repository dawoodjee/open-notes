// Hand-rolled rather than using btoa/atob, and that's deliberate.
//
// btoa/atob exist in Hermes and in Node, but they're defined over "binary
// strings" -- each character's code point is one byte -- so feeding them
// anything that isn't already latin1 silently mangles it. Getting bytes into
// that form means a String.fromCharCode round-trip that's easy to get subtly
// wrong and impossible to notice until a note fails to decrypt.
//
// This file takes Uint8Array in and gives Uint8Array back, with no string
// encoding step in the middle, so it behaves identically under Node (where
// the verification scripts run) and Hermes (where the app runs). ~20 lines is
// a fair price for removing a whole class of platform difference from the
// crypto path.
//
// Hex would have been simpler still, but doubles the size of every stored
// body; base64's 4/3 expansion is meaningfully cheaper over sync bandwidth
// and in Postgres.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse lookup built once. 255 marks "not a base64 character", which is how
// decode detects garbage instead of silently treating it as zero.
const LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i];
    const b = remaining > 1 ? bytes[i + 1] : 0;
    const c = remaining > 2 ? bytes[i + 2] : 0;

    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += remaining > 1 ? ALPHABET[((b & 0x0f) << 2) | (c >> 6)] : '=';
    out += remaining > 2 ? ALPHABET[c & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  // Padding carries no information -- length alone determines the byte count.
  const clean = value.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(byteLength);

  let buffer = 0;
  let bits = 0;
  let written = 0;

  for (let i = 0; i < clean.length; i++) {
    const digit = LOOKUP[clean.charCodeAt(i)];
    if (digit === 255) {
      throw new Error('Invalid base64 input');
    }
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >> bits) & 0xff;
    }
  }

  return out;
}
