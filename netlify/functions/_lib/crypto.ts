import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const encKey = () => Buffer.from(process.env.DATA_ENC_KEY!, 'base64'); // 32 bytes

// AES-256-GCM: formato base64( iv[12] | tag[16] | ciphertext )
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

// "Blind index": permite buscar/deduplicar sem decifrar.
export const blindIndex = (value: string) =>
  createHmac('sha256', Buffer.from(process.env.HASH_KEY!, 'base64')).update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', process.env.WA_APP_SECRET!).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}
