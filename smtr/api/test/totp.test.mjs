import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode, base32Encode, decryptTotp, encryptTotp, matchTotp, newTotpSecret, totpCode,
} from '../src/totp.mjs';

test('TOTP RFC-6238 check, format and replay guard',()=>{
  const secret=newTotpSecret();
  assert.equal(base32Encode(base32Decode(secret)),secret);
  const now=60000;
  const counter=Math.floor(now/30000);
  const otp=totpCode(secret,counter);
  assert.equal(matchTotp(secret,otp,null,now),counter);
  assert.equal(matchTotp(secret,otp,counter,now),null);
  assert.equal(matchTotp(secret,'not-a-code',null,now),null);
});

test('2FA secrets are encrypted with authenticated AES-256-GCM',()=>{
  process.env.SMTR_TOTP_ENCRYPTION_KEY='1'.repeat(64);
  const secret=newTotpSecret();
  const encrypted=encryptTotp(secret);
  assert.notEqual(encrypted,secret);
  assert.equal(decryptTotp(encrypted),secret);
  assert.throws(()=>decryptTotp(encrypted.slice(0,-2)+'AA'));
});
