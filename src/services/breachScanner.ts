/**
 * Pure JavaScript SHA-1 implementation (Zero-dependency, 100% Hermes compatible)
 */
function sha1(message: string): string {
  function rotateLeft(n: number, s: number): number {
    return (n << s) | (n >>> (32 - s));
  }

  function cvtHex(val: number): string {
    let str = '';
    for (let i = 7; i >= 0; i--) {
      const v = (val >>> (i * 4)) & 0x0f;
      str += v.toString(16);
    }
    return str;
  }

  const utf8 = unescape(encodeURIComponent(message));
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  const messageLength = utf8.length * 8;
  words[messageLength >> 5] |= 0x80 << (24 - (messageLength % 32));
  words[(((messageLength + 64) >> 9) << 4) + 15] = messageLength;

  const w: number[] = new Array(80);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  let e = 0xc3d2e1f0;

  for (let i = 0; i < words.length; i += 16) {
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;
    const oldE = e;

    for (let j = 0; j < 80; j++) {
      if (j < 16) {
        w[j] = words[i + j] || 0;
      } else {
        w[j] = rotateLeft(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }

      let f: number, k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotateLeft(a, 5) + f + e + k + (w[j] || 0)) & 0xffffffff;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    a = (a + oldA) & 0xffffffff;
    b = (b + oldB) & 0xffffffff;
    c = (c + oldC) & 0xffffffff;
    d = (d + oldD) & 0xffffffff;
    e = (e + oldE) & 0xffffffff;
  }

  return (cvtHex(a) + cvtHex(b) + cvtHex(c) + cvtHex(d) + cvtHex(e)).toUpperCase();
}

export interface BreachCheckResult {
  isBreached: boolean;
  breachCount: number;
}

/**
 * Check if a password appears in known data breaches using HaveIBeenPwned k-Anonymity API.
 * Only the first 5 characters of SHA-1 hash are sent. Plaintext password is NEVER exposed.
 */
export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  if (!password || password.length === 0) {
    return { isBreached: false, breachCount: 0 };
  }

  try {
    const fullHash = sha1(password);
    const prefix = fullHash.substring(0, 5);
    const suffix = fullHash.substring(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        'Add-Padding': 'true',
      },
    });

    if (!res.ok) {
      return { isBreached: false, breachCount: 0 };
    }

    const text = await res.text();
    const lines = text.split('\r\n');

    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix && hashSuffix.trim().toUpperCase() === suffix) {
        const count = parseInt(countStr.trim(), 10) || 0;
        return { isBreached: count > 0, breachCount: count };
      }
    }

    return { isBreached: false, breachCount: 0 };
  } catch {
    return { isBreached: false, breachCount: 0 };
  }
}
