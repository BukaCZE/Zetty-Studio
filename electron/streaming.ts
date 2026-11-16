import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { app } from 'electron';
import { type OutputSettings, type Platform, type StreamStatus } from '../shared/types.js';
import { validateRtmp } from '../shared/validation.js';
import { Vault } from './vault.js';
const ffmpegStatic = createRequire(import.meta.url)('ffmpeg-static') as string | null;

export const ffmpegPath = () => {
  if (!ffmpegStatic) throw new Error('Chybí FFmpeg. Znovu nainstaluj aplikaci.');
  return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
};
export function encoderArgs(o: OutputSettings): string[] {
  const args = [
    '-c:v',
    o.encoder,
    '-b:v',
    `${o.bitrate}k`,
    '-maxrate',
    `${o.bitrate}k`,
    '-bufsize',
    `${o.bitrate * 2}k`,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(o.fps),
    '-g',
    String(o.fps * 2),
  ];
  if (o.encoder === 'libx264') args.push('-preset', 'veryfast', '-tune', 'zerolatency');
  if (o.encoder === 'h264_nvenc') args.push('-preset', 'p4', '-tune', 'll', '-rc', 'cbr');
  if (o.encoder === 'h264_amf') args.push('-usage', 'ultralowlatency', '-rc', 'cbr');
  if (o.encoder === 'h264_qsv') args.push('-preset', 'veryfast');
  return [...args, '-c:a', 'aac', '-b:a', `${o.audioBitrate}k`, '-ar', '48000', '-ac', '2'];
}
export function teeTarget(url: string) {
  return `[f=flv:onfail=ignore]${url}`;
}
export class StreamEngine {
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;
  private timeout?: ReturnType<typeof setTimeout>;
  private status: StreamStatus = { state: 'idle' };
  private errorTail = '';
  constructor(
    private vault: Vault,
    private emit: (state: StreamStatus) => void,
  ) {}
  get active() {
    return !!this.child;
  }
  async encoders(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath(), ['-hide_banner', '-encoders'], { windowsHide: true });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve(
              ['libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv'].filter((x) => output.includes(x)),
            )
          : reject(new Error('FFmpeg není dostupný.')),
      );
    });
  }
  async start(output: OutputSettings) {
    if (this.child) throw new Error('Vysílání už běží.');
    const targets = Object.entries(this.vault.data.accounts).filter(([, a]) => a.enabled);
    if (!targets.length)
      throw new Error('Vyber alespoň jednu cílovou platformu a nastav streamovací klíč.');
    const urls = targets.map(([, a]) => validateRtmp(a.serverUrl, a.streamKey));
    this.stopping = false;
    this.errorTail = '';
    this.status = { state: 'starting', targets: targets.map(([p]) => p as Platform) };
    this.emit(this.status);
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostats',
      '-progress',
      'pipe:1',
      '-thread_queue_size',
      '512',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      ...encoderArgs(output),
      '-flags',
      '+global_header',
      '-f',
      'tee',
      '-use_fifo',
      '1',
      '-fifo_options',
      'attempt_recovery=1:recover_any_error=1:recovery_wait_time=2:drop_pkts_on_overflow=1:queue_size=240',
      urls.map(teeTarget).join('|'),
    ];
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    this.child = child;
    child.stdin.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    }).catch((error) => {
      this.child = undefined;
      this.emit({ state: 'error', message: 'FFmpeg se nepodařilo spustit: ' + String(error) });
      throw error;
    });
    let progress = '';
    child.stdout.on('data', (chunk) => {
      progress += chunk.toString();
      let end: number;
      while ((end = progress.indexOf('progress=continue')) >= 0) {
        const block = progress.slice(0, end);
        progress = progress.slice(end + 17);
        const fps = Number(block.match(/fps=([\d.]+)/)?.[1] ?? 0);
        const bitrate = Number(block.match(/bitrate=\s*([\d.]+)/)?.[1] ?? 0);
        const frame = Number(block.match(/frame=(\d+)/)?.[1] ?? 0);
        if (frame > 0 && !this.stopping) {
          clearTimeout(this.timeout);
          this.status = {
            ...this.status,
            state: 'live',
            startedAt: this.status.startedAt ?? Date.now(),
            fps,
            bitrate,
          };
          this.emit(this.status);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      let message = String(chunk);
      for (const url of urls) message = message.split(url).join('[cílová platforma]');
      for (const [, a] of targets)
        if (a.streamKey) message = message.split(a.streamKey).join('[skrytý klíč]');
      this.errorTail = (this.errorTail + message).slice(-2000);
      if (/error|failed|refused|timed out/i.test(message))
        this.emit({
          ...this.status,
          message:
            'Některý výstup hlásí problém. Zkontroluj stav ve studiu dané platformy. ' +
            message.trim().slice(-250),
        });
    });
    child.once('close', (code) => {
      clearTimeout(this.timeout);
      if (this.child !== child) return;
      this.child = undefined;
      this.status = this.stopping
        ? { state: 'idle' }
        : {
            state: 'error',
            message: `Vysílání se ukončilo (${code}). ${this.errorTail.slice(-600)}`,
          };
      this.emit(this.status);
    });
    this.timeout = setTimeout(() => {
      if (this.child === child && this.status.state === 'starting') {
        this.errorTail = 'Vysílání nezačalo do 35 s. Zkontroluj enkodér, síť a streamovací klíče.';
        child.kill();
      }
    }, 35000);
  }
  async write(bytes: Uint8Array) {
    const child = this.child;
    if (!child || this.stopping || child.stdin.destroyed)
      throw new Error('Enkodér není připraven.');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1024 * 1024)
      throw new Error('Neplatná velikost mediálního bloku.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Enkodér nestíhá zpracovávat obraz. Sniž rozlišení nebo FPS.')),
        8000,
      );
      child.stdin.write(Buffer.from(bytes), (err) => {
        clearTimeout(timer);
        err ? reject(new Error('Zápis do enkodéru selhal.')) : resolve();
      });
    });
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    clearTimeout(this.timeout);
    this.emit({ ...this.status, state: 'stopping' });
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  dispose() {
    clearTimeout(this.timeout);
    this.stopping = true;
    this.child?.kill();
  }
}
