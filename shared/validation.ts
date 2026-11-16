import { z } from 'zod';
import { platformIds } from './types.js';
export const platformSchema = z.enum(platformIds);
export const outputSchema = z
  .object({
    width: z.union([z.literal(1280), z.literal(1920), z.literal(1080), z.literal(720)]),
    height: z.union([z.literal(720), z.literal(1080), z.literal(1920), z.literal(1280)]),
    fps: z.union([z.literal(30), z.literal(60)]),
    bitrate: z.number().int().min(1000).max(20000),
    audioBitrate: z.union([
      z.literal(128),
      z.literal(160),
      z.literal(192),
      z.literal(256),
      z.literal(320),
    ]),
    encoder: z.enum(['libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv']),
  })
  .refine(
    (o) => ['1920x1080', '1280x720', '1080x1920', '720x1280'].includes(`${o.width}x${o.height}`),
    'Nepodporované rozlišení.',
  );
export const accountPatchSchema = z.object({
  platform: platformSchema,
  clientId: z.string().trim().max(256).optional(),
  clientSecret: z.string().max(4096).optional(),
  serverUrl: z.string().trim().max(2048).optional(),
  streamKey: z.string().trim().max(2048).optional(),
  enabled: z.boolean().optional(),
});
const sourceSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(100),
  kind: z.enum(['screen', 'camera', 'image', 'video', 'text', 'color', 'browser', 'alerts']),
  visible: z.boolean(),
  locked: z.boolean(),
  x: z.number().min(-10000).max(10000),
  y: z.number().min(-10000).max(10000),
  width: z.number().min(1).max(8000),
  height: z.number().min(1).max(8000),
  opacity: z.number().min(0).max(1),
  value: z.string().max(8000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontSize: z.number().min(8).max(300),
  deviceId: z.string().max(1024).optional(),
  captureName: z.string().max(256).optional(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  loop: z.boolean(),
  fit: z.enum(['contain', 'cover']),
});
export const workspaceSchema = z
  .object({
    scenes: z
      .array(
        z.object({
          id: z.string().max(100),
          name: z.string().min(1).max(100),
          sources: z.array(sourceSchema).max(50),
          background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        }),
      )
      .min(1)
      .max(50),
    activeSceneId: z.string().max(100),
    output: outputSchema,
    microphoneId: z.string().max(1024),
    microphoneVolume: z.number().min(0).max(1),
    microphoneMuted: z.boolean(),
    desktopVolume: z.number().min(0).max(1),
    desktopMuted: z.boolean(),
    alertSound: z.boolean(),
    showAlerts: z.boolean(),
  })
  .refine((w) => w.scenes.some((s) => s.id === w.activeSceneId), 'Chybí aktivní scéna.')
  .refine((w) => {
    const ids = w.scenes.flatMap((s) => [s.id, ...s.sources.map((x) => x.id)]);
    return new Set(ids).size === ids.length;
  }, 'Scény a zdroje musí mít jedinečná ID.');
export function validateRtmp(server: string, key: string): string {
  const url = new URL(server);
  if (
    !['rtmp:', 'rtmps:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Použij platnou RTMP/RTMPS adresu bez přihlašovacích údajů v URL.');
  const result = server.replace(/\/$/, '') + '/' + key;
  if (!key || /[\s\[\]|'"\\]/.test(result))
    throw new Error('RTMP adresa nebo klíč obsahuje nepodporované znaky.');
  return result;
}
