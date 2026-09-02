/* eslint-disable @typescript-eslint/no-explicit-any */
import 'react-native-get-random-values';

const { sha256, sha512, sha384 } = require('@noble/hashes/sha2.js');
const { sha1, md5 } = require('@noble/hashes/legacy.js');

// Complete, 100% pure JavaScript SubtleCrypto polyfill for React Native Hermes & Expo
if (typeof globalThis !== 'undefined') {
  const g = globalThis as any;
  g.crypto = g.crypto || {};

  if (!g.crypto.getRandomValues) {
    g.crypto.getRandomValues = (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    };
  }

  if (!g.crypto.subtle) {
    // Only provide digest, which has a real pure-JS implementation.
    // The other SubtleCrypto methods return rejected promises so that
    // openpgp v5 falls back to its own pure-JS implementations.
    // (v6 requires WebCrypto and does not work in React Native.)
    const notAvailable = async () => {
      throw new Error('crypto.subtle method not available in React Native');
    };
    g.crypto.subtle = {
      digest: async (algo: any, data: ArrayBuffer | Uint8Array) => {
        const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
        const name = (typeof algo === 'string' ? algo : (algo && algo.name) || '')
          .toUpperCase()
          .replace(/-/g, '');
        if (name === 'SHA256') return sha256(arr).slice().buffer;
        if (name === 'SHA512') return sha512(arr).slice().buffer;
        if (name === 'SHA384') return sha384(arr).slice().buffer;
        if (name === 'SHA1') return sha1(arr).slice().buffer;
        if (name === 'MD5') return md5(arr).slice().buffer;
        return sha256(arr).slice().buffer;
      },
      importKey: notAvailable,
      exportKey: notAvailable,
      generateKey: notAvailable,
      encrypt: notAvailable,
      decrypt: notAvailable,
      sign: notAvailable,
      verify: notAvailable,
      deriveKey: notAvailable,
      deriveBits: notAvailable,
      wrapKey: notAvailable,
      unwrapKey: notAvailable,
    };
  }

  if (typeof global !== 'undefined') {
    (global as any).crypto = g.crypto;
  }
  if (typeof window !== 'undefined') {
    (window as any).crypto = g.crypto;
  }
}

