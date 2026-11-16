import { timingSafeEqual, verify } from 'node:crypto';
export function validToken(header: string | undefined, token: string) {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function verifyKick(
  publicKey: string,
  id: string,
  timestamp: string,
  body: Buffer,
  signature: string,
  now = Date.now(),
) {
  if (
    !id ||
    !timestamp ||
    !signature ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Math.abs(now - Date.parse(timestamp)) > 5 * 60 * 1000
  )
    return false;
  try {
    return verify(
      'RSA-SHA256',
      Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
