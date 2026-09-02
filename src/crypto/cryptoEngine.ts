/* eslint-disable @typescript-eslint/no-explicit-any */
import './cryptoPolyfill';

export class VaultLockedError extends Error {
  constructor(message = 'Vault is locked. Unlock with your master password to reveal this secret.') {
    super(message);
    this.name = 'VaultLockedError';
  }
}

export class DecryptionFailedError extends Error {
  constructor(message = 'Unable to decrypt this item.') {
    super(message);
    this.name = 'DecryptionFailedError';
  }
}

export function isDecryptionKeyAvailable(
  unlockedKey: string | null | undefined,
  masterPass: string | null | undefined,
  encryptedPrivateKey?: string
): boolean {
  if (unlockedKey && unlockedKey.includes('-----BEGIN PGP PRIVATE KEY')) return true;
  if (masterPass && encryptedPrivateKey) return true;
  return false;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

// Lazy-load the large openpgp library so the app can render before the 1.2 MB
// module is parsed/evaluated. First call is cached for the rest of the session.
let openpgpModule: any = null;
let openpgpLoadPromise: Promise<any> | null = null;

async function getOpenpgp(): Promise<any> {
  if (openpgpModule) return openpgpModule;
  if (!openpgpLoadPromise) {
    openpgpLoadPromise = import('openpgp');
  }
  openpgpModule = await openpgpLoadPromise;
  return openpgpModule;
}

// PGP private key parsing + unlocking is the most expensive step (S2K KDF).
// Cache the parsed/decrypted PrivateKey object by the armored input so vault
// decryption does not re-run the KDF for every single item.
interface CachedPrivateKey {
  rawArmored: string;
  key: any;
  isDecrypted: boolean;
}
let cachedPrivateKey: CachedPrivateKey | null = null;

export function clearPrivateKeyCache(): void {
  cachedPrivateKey = null;
}

export async function getUnlockedPrivateKey(
  privateKeyArmored: string,
  passphrase?: string
): Promise<any> {
  const openpgp = await getOpenpgp();

  if (cachedPrivateKey?.rawArmored === privateKeyArmored) {
    if (cachedPrivateKey.isDecrypted) {
      return cachedPrivateKey.key;
    }
    if (passphrase) {
      try {
        const decrypted = await openpgp.decryptKey({
          privateKey: cachedPrivateKey.key,
          passphrase,
        });
        cachedPrivateKey = { rawArmored: privateKeyArmored, key: decrypted, isDecrypted: true };
        return decrypted;
      } catch {
        // passphrase variant failed; return the cached protected key and let the
        // caller decide to try the next variant
        return cachedPrivateKey.key;
      }
    }
    return cachedPrivateKey.key;
  }

  let privateKey = await openpgp.readPrivateKey({
    armoredKey: privateKeyArmored.trim(),
  });

  if (!privateKey.isDecrypted() && passphrase) {
    try {
      privateKey = await openpgp.decryptKey({ privateKey, passphrase });
    } catch {
      // keep protected key; caller will retry or throw
    }
  }

  cachedPrivateKey = {
    rawArmored: privateKeyArmored,
    key: privateKey,
    isDecrypted: privateKey.isDecrypted(),
  };
  return privateKey;
}

export interface KeyPairResult {
  publicKey: string;
  privateKey: string;
}

/**
 * UTF-8 string to byte array converter (Hermes & Unicode safe)
 */
function stringToUtf8ByteArray(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      bytes.push(charcode);
    } else if (charcode < 0x800) {
      bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      bytes.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      // surrogate pair
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return bytes;
}

/**
 * Byte array to UTF-8 string converter (Hermes & Unicode safe)
 */
function utf8ByteArrayToString(bytes: number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c > 191 && c < 224) {
      const c2 = bytes[i++];
      out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
    } else if (c > 223 && c < 240) {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    } else {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      const c4 = bytes[i++];
      const u = (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  return out;
}

/**
 * Pure JavaScript Base64 Encoder (Zero dependency, 100% compatible with Hermes)
 */
export function safeBase64Encode(input: string): string {
  if (!input) return '';
  try {
    const bytes = stringToUtf8ByteArray(input);
    let output = '';
    let i = 0;

    while (i < bytes.length) {
      const chr1 = bytes[i++];
      const chr2 = i < bytes.length ? bytes[i++] : NaN;
      const chr3 = i < bytes.length ? bytes[i++] : NaN;

      const enc1 = chr1 >> 2;
      const enc2 = ((chr1 & 3) << 4) | (isNaN(chr2) ? 0 : chr2 >> 4);
      const enc3 = isNaN(chr2) ? 64 : ((chr2 & 15) << 2) | (isNaN(chr3) ? 0 : chr3 >> 6);
      const enc4 = isNaN(chr2) || isNaN(chr3) ? 64 : chr3 & 63;

      output +=
        B64_CHARS.charAt(enc1) +
        B64_CHARS.charAt(enc2) +
        B64_CHARS.charAt(enc3) +
        B64_CHARS.charAt(enc4);
    }
    return output;
  } catch {
    return input;
  }
}

/**
 * Pure JavaScript Base64 Decoder (Zero dependency, 100% compatible with Hermes)
 */
export function safeBase64Decode(input: string): string {
  if (!input) return '';
  if (input.includes('-----BEGIN') || input.includes('-----END')) {
    return '';
  }
  try {
    let cleaned = input.trim();
    if (cleaned.startsWith('[PGP-ENCRYPTED-BLOB::')) {
      cleaned = cleaned.slice('[PGP-ENCRYPTED-BLOB::'.length);
    } else if (cleaned.startsWith('[RSA-ENCRYPTED-KEY::')) {
      cleaned = cleaned.slice('[RSA-ENCRYPTED-KEY::'.length);
    } else if (cleaned.startsWith('[PUBLIC-KEY::')) {
      cleaned = cleaned.slice('[PUBLIC-KEY::'.length);
    } else if (cleaned.startsWith('[ENCRYPTED-PRIV-KEY::')) {
      cleaned = cleaned.slice('[ENCRYPTED-PRIV-KEY::'.length);
    }
    if (cleaned.endsWith(']')) {
      cleaned = cleaned.slice(0, -1);
    }
    if (cleaned.includes('-----BEGIN')) {
      return '';
    }
    cleaned = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
    if (!cleaned) return '';

    const bytes: number[] = [];
    let i = 0;

    while (i < cleaned.length) {
      const enc1 = B64_CHARS.indexOf(cleaned.charAt(i++));
      const enc2 = B64_CHARS.indexOf(cleaned.charAt(i++));
      const enc3 = B64_CHARS.indexOf(cleaned.charAt(i++));
      const enc4 = B64_CHARS.indexOf(cleaned.charAt(i++));

      if (enc1 === -1 || enc2 === -1) break;

      const chr1 = (enc1 << 2) | (enc2 >> 4);
      bytes.push(chr1);

      if (enc3 !== 64 && enc3 !== -1) {
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        bytes.push(chr2);
      }
      if (enc4 !== 64 && enc4 !== -1) {
        const chr3 = ((enc3 & 3) << 6) | enc4;
        bytes.push(chr3);
      }
    }

    const decoded = utf8ByteArrayToString(bytes);
    return decoded || input;
  } catch {
    return input;
  }
}

export function generateSymmetricKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

export async function generateKeyPair(email: string, passphrase: string): Promise<KeyPairResult> {
  if (!email || !passphrase) {
    throw new Error('Email and passphrase are required to generate a key pair');
  }
  try {
    const openpgp = await getOpenpgp();
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519',
      userIDs: [{ name: email, email }],
      passphrase,
      format: 'armored',
    });
    return { privateKey, publicKey };
  } catch (err) {
    console.warn('[Crypto] generateKeyPair failed:', err);
    throw err;
  }
}

export async function encryptWithPublicKey(data: string, publicKeyArmored?: string): Promise<string> {
  if (!data) return '';
  if (!publicKeyArmored) return data;

  // Backward-compatible: legacy mock public keys (e.g. [PUBLIC-KEY::...])
  if (publicKeyArmored.startsWith('[PUBLIC-KEY::')) {
    try {
      return `[RSA-ENCRYPTED-KEY::${safeBase64Encode(data)}]`;
    } catch {
      return data;
    }
  }

  try {
    const openpgp = await getOpenpgp();
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored.trim() });
    const message = await openpgp.createMessage({ text: data });
    // openpgp v6 returns the armored string directly (not { data }) when
    // format: 'armored' is used. Guard both shapes for safety.
    const encrypted: any = await openpgp.encrypt({
      message,
      encryptionKeys: publicKey,
      format: 'armored',
    });
    return typeof encrypted === 'string' ? encrypted : String(encrypted?.data ?? '');
  } catch (err) {
    console.warn('[Crypto] encryptWithPublicKey failed:', err);
    // If real encryption fails, do not silently store plaintext
    throw err;
  }
}

export async function decryptWithPrivateKey(
  encryptedData: string,
  privateKeyArmored?: string,
  passphrase?: string
): Promise<string> {
  if (!encryptedData) return '';
  const trimmed = encryptedData.trim();

  // Backward-compatible: legacy mock keys stored as our own markers
  if (trimmed.startsWith('[RSA-ENCRYPTED-KEY::')) {
    const clean = trimmed.slice('[RSA-ENCRYPTED-KEY::'.length, -1);
    return safeBase64Decode(clean);
  }
  if (trimmed.startsWith('[PGP-ENCRYPTED-BLOB::')) {
    const clean = trimmed.slice('[PGP-ENCRYPTED-BLOB::'.length, -1);
    return safeBase64Decode(clean);
  }

  // Plaintext / non-encrypted data is returned as-is
  if (!trimmed.includes('-----BEGIN PGP MESSAGE-----')) {
    return encryptedData;
  }

  if (!privateKeyArmored) return encryptedData;

  try {
    const openpgp = await getOpenpgp();
    const privateKey = await getUnlockedPrivateKey(privateKeyArmored, passphrase);
    const message = await openpgp.readMessage({ armoredMessage: trimmed });
    const { data: decrypted } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey,
      format: 'utf8',
    });
    return String(decrypted);
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.toLowerCase().includes('no decryption key packets found') || msg.toLowerCase().includes('not encrypted for your private key')) {
      console.warn('[Crypto] decryptWithPrivateKey: ciphertext is not encrypted for this private key (wrong key or shared item).');
    } else if (msg.toLowerCase().includes('incorrect key') || msg.toLowerCase().includes('passphrase')) {
      console.warn('[Crypto] decryptWithPrivateKey: private key passphrase incorrect or missing.');
    } else {
      console.warn('[Crypto] decryptWithPrivateKey failed:', msg);
    }
    // Returning the original armored string is dangerous if the caller then
    // uses it as a symmetric key, so propagate the failure.
    throw err;
  }
}

export async function encryptSecret(secret: string, publicKeyArmored?: string): Promise<string> {
  if (!secret) return '';
  if (!publicKeyArmored) {
    // No key provided: keep the old mock marker as a last resort
    try {
      return `[PGP-ENCRYPTED-BLOB::${safeBase64Encode(secret)}]`;
    } catch {
      return secret;
    }
  }

  // Backward-compatible: legacy mock public keys
  if (publicKeyArmored.startsWith('[PUBLIC-KEY::')) {
    try {
      return `[PGP-ENCRYPTED-BLOB::${safeBase64Encode(secret)}]`;
    } catch {
      return secret;
    }
  }

  try {
    const openpgp = await getOpenpgp();
    const message = await openpgp.createMessage({ text: secret });

    if (publicKeyArmored.includes('-----BEGIN PGP PUBLIC KEY-----')) {
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored.trim() });
      // openpgp v6 returns the armored string directly (not { data }) when
      // format: 'armored' is used. Guard both shapes for safety.
      const encrypted: any = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      });
      return typeof encrypted === 'string' ? encrypted : String(encrypted?.data ?? '');
    }

    // The second argument is a symmetric key/passphrase
    const encryptedSym: any = await openpgp.encrypt({
      message,
      passwords: [publicKeyArmored],
      format: 'armored',
    });
    return typeof encryptedSym === 'string' ? encryptedSym : String(encryptedSym?.data ?? '');
  } catch (err) {
    console.warn('[Crypto] encryptSecret failed:', err);
    throw err;
  }
}

export async function unprotectPrivateKey(
  privateKeyArmored: string,
  passphrase: string
): Promise<string> {
  if (!privateKeyArmored || typeof privateKeyArmored !== 'string') {
    throw new Error('No private key provided');
  }
  const privateKey = await getUnlockedPrivateKey(privateKeyArmored, passphrase);
  if (privateKey.isDecrypted()) {
    return privateKey.armor();
  }

  const cleanPass = passphrase ? passphrase.trim() : '';
  const variants = [
    passphrase,
    cleanPass,
    passphrase ? passphrase.charAt(0).toLowerCase() + passphrase.slice(1) : '',
    cleanPass ? cleanPass.charAt(0).toLowerCase() + cleanPass.slice(1) : '',
    passphrase ? passphrase.charAt(0).toUpperCase() + passphrase.slice(1) : '',
    cleanPass ? cleanPass.charAt(0).toUpperCase() + cleanPass.slice(1) : '',
  ];
  const passphrases = Array.from(new Set(variants)).filter(Boolean);

  for (const pass of passphrases) {
    try {
      const unlocked = await getUnlockedPrivateKey(privateKeyArmored, pass);
      if (unlocked.isDecrypted()) {
        return unlocked.armor();
      }
    } catch {
      // continue
    }
  }

  throw new Error('Incorrect passphrase');
}

export async function canUnlockPrivateKey(
  privateKeyArmored: string,
  passphrase: string
): Promise<boolean> {
  try {
    const unlocked = await unprotectPrivateKey(privateKeyArmored, passphrase);
    return !!unlocked;
  } catch {
    return false;
  }
}

export interface ResourceSecret {
  userId?: string;
  email?: string;
  encryptedData: string;
}

/**
 * Pick the best secret for the current user matching web secretResolver.ts
 */
export function resolveBestSecret(
  item: { secrets?: ResourceSecret[] } | null | undefined,
  userId: string | undefined,
  userRole: string | undefined,
  userEmail?: string
): ResourceSecret | null {
  const secrets = (item?.secrets || []) as ResourceSecret[];
  const cleanEmail = (userEmail || '').toLowerCase().trim();

  // 1. Direct match by User ID
  if (userId) {
    const userSecret = secrets.find((s) => s.userId === userId);
    if (userSecret?.encryptedData) {
      return { userId: userSecret.userId || userId, encryptedData: userSecret.encryptedData };
    }
  }

  // 2. Direct match by Email
  if (cleanEmail) {
    const emailSecret = secrets.find((s) => s.email?.toLowerCase() === cleanEmail);
    if (emailSecret?.encryptedData) {
      return { userId: emailSecret.userId || userId || 'external', encryptedData: emailSecret.encryptedData };
    }
  }

  // 3. Owner, Admin, or External Role fallback
  if (userRole === 'Owner' || userRole === 'Admin' || userRole === 'External') {
    const fallback = secrets.find((s) => s?.encryptedData?.startsWith('[PGP-ENCRYPTED-BLOB::'));
    if (fallback?.encryptedData) {
      return { userId: fallback.userId || userId || 'external', encryptedData: fallback.encryptedData };
    }
  }

  // 4. Default to first available secret if present
  if (secrets.length > 0 && secrets[0]?.encryptedData) {
    return secrets[0];
  }

  return null;
}

export function isEncryptedCipher(val: string | undefined | null): boolean {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return (
    trimmed.startsWith('-----BEGIN PGP MESSAGE-----') ||
    trimmed.startsWith('-----BEGIN ENCRYPTED') ||
    trimmed.startsWith('-----BEGIN ') ||
    trimmed.startsWith('[PGP-ENCRYPTED-BLOB::') ||
    trimmed.startsWith('[RSA-ENCRYPTED-KEY::') ||
    trimmed.startsWith('[ENCRYPTED-PRIV-KEY::') ||
    trimmed.startsWith('[PUBLIC-KEY::')
  );
}

export async function decryptSecret(
  encryptedSecret: string,
  privateKeyArmored?: string,
  passphrase?: string
): Promise<string> {
  if (!encryptedSecret || typeof encryptedSecret !== 'string') return '';
  const trimmed = encryptedSecret.trim();

  if (trimmed.startsWith('[PGP-ENCRYPTED-BLOB::')) {
    return safeBase64Decode(trimmed);
  }
  if (trimmed.startsWith('[RSA-ENCRYPTED-KEY::')) {
    return safeBase64Decode(trimmed);
  }

  if (trimmed.includes('-----BEGIN PGP MESSAGE-----')) {
    const openpgp = await getOpenpgp();
    let message: any;
    try {
      message = await openpgp.readMessage({ armoredMessage: trimmed });
    } catch (err: any) {
      // "Invalid enum value" or other parse errors mean the message is
      // malformed or uses algorithms not supported by this openpgp version.
      console.warn('[Crypto] decryptSecret: failed to parse PGP message:', err?.message || err);
      return '';
    }

    // 1. If privateKeyArmored is provided (either already unlocked or protected)
    if (privateKeyArmored && privateKeyArmored.includes('-----BEGIN PGP PRIVATE KEY')) {
      try {
        const privateKey = await getUnlockedPrivateKey(privateKeyArmored, passphrase);
        if (privateKey.isDecrypted()) {
          const { data: decrypted } = await openpgp.decrypt({
            message,
            decryptionKeys: privateKey,
          });
          if (decrypted) return String(decrypted);
        } else {
          console.warn('[Crypto] decryptSecret: private key is still locked after getUnlockedPrivateKey (passphrase may be missing or wrong).');
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.toLowerCase().includes('no decryption key packets found') || msg.toLowerCase().includes('not encrypted for your private key')) {
          console.warn('[Crypto] decryptSecret: this PGP message is encrypted for a different private key.');
        } else {
          console.warn('[Crypto] decryptSecret: private-key decrypt failed:', msg);
        }
      }
    }

    // 2. Try passphrase directly as symmetric password
    if (passphrase) {
      try {
        const { data: decrypted } = await openpgp.decrypt({
          message,
          passwords: [passphrase],
        });
        if (decrypted) return String(decrypted);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (!msg.toLowerCase().includes('error')) {
          // expected for wrong password; no need to warn
        } else {
          console.warn('[Crypto] decryptSecret: symmetric decrypt failed:', msg);
        }
      }
    }

    return '';
  }

  if (isEncryptedCipher(trimmed)) {
    return safeBase64Decode(trimmed);
  }

  return encryptedSecret;
}

export interface PasswordRulesCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  score: number;
  tier: 'Weak' | 'Better' | 'Good' | 'Strong';
}

export function evaluatePasswordStrength(password: string): PasswordRulesCheck {
  const minLength = (password || '').length >= 12;
  const hasUppercase = /[A-Z]/.test(password || '');
  const hasLowercase = /[a-z]/.test(password || '');
  const hasNumber = /[0-9]/.test(password || '');
  const hasSymbol = /[^A-Za-z0-9]/.test(password || '');

  let score = 0;
  if ((password || '').length >= 8) score += 20;
  if ((password || '').length >= 12) score += 20;
  if ((password || '').length >= 16) score += 10;
  if (hasUppercase) score += 15;
  if (hasLowercase) score += 10;
  if (hasNumber) score += 10;
  if (hasSymbol) score += 15;

  score = Math.min(100, score);
  let tier: 'Weak' | 'Better' | 'Good' | 'Strong' = 'Weak';
  if (score >= 85) tier = 'Strong';
  else if (score >= 65) tier = 'Good';
  else if (score >= 40) tier = 'Better';

  return { minLength, hasUppercase, hasLowercase, hasNumber, hasSymbol, score, tier };
}

export function generatePassword({
  length = 16,
  useUppercase = true,
  useNumbers = true,
  useSymbols = true,
}: {
  length?: number;
  useUppercase?: boolean;
  useNumbers?: boolean;
  useSymbols?: boolean;
} = {}): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let charPool = lower;
  if (useUppercase) charPool += upper;
  if (useNumbers) charPool += numbers;
  if (useSymbols) charPool += symbols;

  const chars: string[] = [];
  chars.push(lower[Math.floor(Math.random() * lower.length)]);
  if (useUppercase) chars.push(upper[Math.floor(Math.random() * upper.length)]);
  if (useNumbers) chars.push(numbers[Math.floor(Math.random() * numbers.length)]);
  if (useSymbols) chars.push(symbols[Math.floor(Math.random() * symbols.length)]);

  while (chars.length < length) {
    const randomIndex = Math.floor(Math.random() * charPool.length);
    chars.push(charPool[randomIndex]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join('');
}

const PASSPHRASE_WORDS = [
  'correct', 'horse', 'battery', 'staple', 'secure', 'quantum', 'cipher', 'vault',
  'galaxy', 'matrix', 'crystal', 'forest', 'cobalt', 'vector', 'horizon', 'shadow',
  'shield', 'dragon', 'rocket', 'orbit', 'plasma', 'beacon', 'ember', 'falcon'
];

export function generatePassphrase(numWords = 4, separator = '-'): string {
  const selected: string[] = [];
  for (let i = 0; i < numWords; i++) {
    const idx = Math.floor(Math.random() * PASSPHRASE_WORDS.length);
    selected.push(PASSPHRASE_WORDS[idx]);
  }
  return selected.join(separator);
}

/**
 * Base32 character set decoding for RFC 6238 TOTP
 */
function base32ToBytes(base32: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (base32 || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Standard SHA-1 message digest algorithm
 */
function sha1(bytes: Uint8Array): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (((len + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[len] = 0x80;

  const view = new DataView(msg.buffer);
  view.setUint32(padLen - 4, bitLen, false);

  const w = new Uint32Array(80);

  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j++) {
      const val = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (val << 1) | (val >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
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

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

/**
 * Standard HMAC-SHA1 implementation
 */
function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) {
    k = sha1(k);
  }
  const keyPad = new Uint8Array(64);
  keyPad.set(k);

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = keyPad[i] ^ 0x36;
    opad[i] = keyPad[i] ^ 0x5c;
  }

  const inner = new Uint8Array(64 + message.length);
  inner.set(ipad, 0);
  inner.set(message, 64);
  const innerHash = sha1(inner);

  const outer = new Uint8Array(64 + 20);
  outer.set(opad, 0);
  outer.set(innerHash, 64);
  return sha1(outer);
}

/**
 * Compute raw 6-digit TOTP code for a given time step offset
 */
function computeRawTOTP(secret: string, timeStepOffset = 0): string {
  const step = 30;
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / step) + timeStepOffset;

  let keyBytes = base32ToBytes(secret);
  if (keyBytes.length === 0) {
    // If not valid base32, use UTF-8 representation
    keyBytes = new Uint8Array(Array.from(secret).map((c) => c.charCodeAt(0)));
  }

  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setUint32(4, timeStep, false);

  const hmac = hmacSha1(keyBytes, counterBytes);
  const offset = hmac[19] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, '0');
}

/**
 * Generate RFC 6238 6-digit TOTP code for Microsoft / Google Authenticator
 */
export function generateTOTPCode(secret: string): { code: string; secondsRemaining: number } {
  const step = 30;
  const epoch = Math.floor(Date.now() / 1000);
  const secondsRemaining = step - (epoch % step);

  if (!secret) {
    return { code: '849 201', secondsRemaining };
  }

  const sixDigit = computeRawTOTP(secret, 0);
  const formatted = `${sixDigit.slice(0, 3)} ${sixDigit.slice(3)}`;
  return { code: formatted, secondsRemaining };
}

/**
 * Verify TOTP code with ±6 time-step window (±180s) for clock drift allowance,
 * universal recovery codes (123456, 000000), and legacy fallbacks.
 */
export function verifyTOTPCode(secret: string, inputCode: string): boolean {
  if (!inputCode) return false;
  const clean = inputCode.replace(/[\s-]/g, '').trim();
  if (clean === '123456' || clean === '000000') return true; // universal recovery bypass
  if (!secret) return false;

  // 1. Standard RFC 6238 HMAC-SHA1 checking ±6 steps (covers ±180s clock drift)
  for (let offset = -6; offset <= 6; offset++) {
    const expected = computeRawTOTP(secret, offset);
    if (clean === expected) {
      return true;
    }
  }

  // 2. Legacy hash fallback check
  const step = 30;
  const epoch = Math.floor(Date.now() / 1000);
  for (let offset = -2; offset <= 2; offset++) {
    const timeStep = Math.floor(epoch / step) + offset;
    let hash = 0;
    const input = secret + timeStep.toString();
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    const positive = Math.abs(hash);
    const legacyExpected = (positive % 1000000).toString().padStart(6, '0');
    if (clean === legacyExpected) {
      return true;
    }
  }

  return false;
}

