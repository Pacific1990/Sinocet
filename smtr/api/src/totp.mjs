import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits -= 5)) & 31]; }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export function base32Decode(text) {
  const input = String(text).replace(/=+$/, '').toUpperCase().replace(/\s/g,'');
  if (!/^[A-Z2-7]{16,64}$/.test(input)) throw new Error('Invalid TOTP secret');
  let bits = 0, value = 0;
  const out = [];
  for (const char of input) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) out.push((value >>> (bits -= 8)) & 255);
  }
  return Buffer.from(out);
}
function encryptionKey() {
  const value = process.env.SMTR_TOTP_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('SMTR_TOTP_ENCRYPTION_KEY must be 64 hex characters');
  return Buffer.from(value, 'hex');
}
export function encryptTotp(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const result = Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),result.toString('base64url')].join('.');
}
export function decryptTotp(ciphertext) {
  const [nonce,tag,encoded] = String(ciphertext).split('.');
  if (!nonce||!tag||!encoded) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(nonce,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encoded,'base64url')),decipher.final()]).toString('utf8');
}
export function totpCode(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1',base32Decode(secret)).update(buffer).digest();
  const offset = digest.at(-1) & 15;
  const integer = (digest.readUInt32BE(offset) & 0x7fffffff);
  return String(integer % 1000000).padStart(6,'0');
}
export function matchTotp(secret, submitted, lastCounter = null, at = Date.now()) {
  if (!/^\d{6}$/.test(String(submitted))) return null;
  const current = Math.floor(at / 30000);
  for (const counter of [current - 1,current,current + 1]) {
    if (lastCounter !== null && counter <= Number(lastCounter)) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret,counter)),Buffer.from(String(submitted)))) {
      return counter;
    }
  }
  return null;
}
