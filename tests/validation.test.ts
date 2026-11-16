import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { validateRtmp, outputSchema, workspaceSchema } from '../shared/validation.js';
import { validToken, verifyKick } from '../relay/security.js';
test('RTMP destination accepts ordinary keys and rejects tee injection', () => {
  assert.equal(
    validateRtmp('rtmps://server.example/app/', 'live_123-abc'),
    'rtmps://server.example/app/live_123-abc',
  );
  for (const key of ['abc|[f=file]/secret', 'bad\nkey', 'a\\b', "abc'def", ''])
    assert.throws(() => validateRtmp('rtmp://server.example/app', key));
  for (const server of [
    'https://example.com',
    'file:///tmp/stream',
    'rtmp://user:pass@example.com/app',
  ])
    assert.throws(() => validateRtmp(server, 'valid'));
});
test('stream output validates resource limits and supported codecs', () => {
  const valid = {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 6000,
    audioBitrate: 160,
    encoder: 'libx264',
  };
  assert.equal(outputSchema.parse(valid).bitrate, 6000);
  for (const patch of [
    { fps: 120 },
    { bitrate: -100 },
    { bitrate: Infinity },
    { width: 8000 },
    { encoder: 'arbitrary' },
  ])
    assert.equal(outputSchema.safeParse({ ...valid, ...patch }).success, false);
});
test('project import rejects missing scenes and malformed inputs', () => {
  assert.equal(workspaceSchema.safeParse({ scenes: [] }).success, false);
  assert.equal(workspaceSchema.safeParse({ scenes: 'not scenes' }).success, false);
});
test('relay authenticates exact bearer tokens', () => {
  assert.equal(validToken('Bearer correct-key', 'correct-key'), true);
  assert.equal(validToken('Bearer incorrect', 'correct-key'), false);
  assert.equal(validToken(undefined, 'correct-key'), false);
});
test('Kick webhook verifies raw body signature, timestamp and tampering', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const id = 'event123';
  const body = Buffer.from('{"content":"Ahoj"}');
  const signature = sign(
    'RSA-SHA256',
    Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]),
    privateKey,
  ).toString('base64');
  assert.equal(verifyKick(publicKey, id, timestamp, body, signature, now), true);
  assert.equal(verifyKick(publicKey, id, timestamp, Buffer.from('{}'), signature, now), false);
  assert.equal(verifyKick(publicKey, id, timestamp, body, signature, now + 600001), false);
  assert.equal(verifyKick(publicKey, id, 'invalid', body, signature, now), false);
});
