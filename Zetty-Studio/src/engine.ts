import type { SceneSource, Workspace, StreamAlert } from '../shared/types';
import { bridge } from './bridge';

interface Resource {
  signature: string;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  stream?: MediaStream;
  audio?: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  gain?: GainNode;
  analyser?: AnalyserNode;
  disposed?: boolean;
}
type RecorderJob = {
  recorder: MediaRecorder;
  queue: Promise<void>;
  queued: number;
  failed: boolean;
  tracks: MediaStreamTrack[];
};
export class StudioEngine {
  workspace?: Workspace;
  private resources = new Map<string, Resource>();
  private frames = new Map<string, HTMLImageElement>();
  private context: CanvasRenderingContext2D;
  private raf = 0;
  private lastFrame = 0;
  private lastMeter = 0;
  private audio?: AudioContext;
  private destination?: MediaStreamAudioDestinationNode;
  private mic?: MediaStream;
  private micGain?: GainNode;
  private micAnalyser?: AnalyserNode;
  private micSource?: MediaStreamAudioSourceNode;
  private streamJob?: RecorderJob;
  private recordingJob?: RecorderJob;
  private alert?: StreamAlert;
  private alertUntil = 0;
  private unsubscribe: () => void;
  private running = true;
  constructor(
    public canvas: HTMLCanvasElement,
    private onError: (message: string) => void,
    private onMeters: (mic: number, desktop: number) => void,
  ) {
    this.context = canvas.getContext('2d', { alpha: false })!;
    this.unsubscribe = bridge.onEvent((event) => {
      if (event.type === 'browser-frame') {
        const { id, image } = event.data as { id: string; image: string };
        const img = new Image();
        img.onload = () => {
          if (this.resources.has(id)) this.frames.set(id, img);
        };
        img.src = image;
      }
    });
    this.draw(0);
  }
  update(workspace: Workspace) {
    this.workspace = workspace;
    if (
      this.canvas.width !== workspace.output.width ||
      this.canvas.height !== workspace.output.height
    ) {
      this.canvas.width = workspace.output.width;
      this.canvas.height = workspace.output.height;
    }
    if (this.micGain)
      this.micGain.gain.value = workspace.microphoneMuted ? 0 : workspace.microphoneVolume;
    const ids = new Set(workspace.scenes.flatMap((s) => s.sources.map((x) => x.id)));
    for (const id of this.resources.keys()) if (!ids.has(id)) this.release(id);
    const active = workspace.scenes.find((s) => s.id === workspace.activeSceneId)!;
    const desktopSource = active.sources.find(
      (s) => s.visible && this.resources.get(s.id)?.stream?.getAudioTracks().length,
    );
    for (const [id, r] of this.resources) {
      const item = active.sources.find((s) => s.id === id);
      if (r.gain) {
        const level = r.stream
          ? workspace.desktopMuted || desktopSource?.id !== id
            ? 0
            : workspace.desktopVolume
          : item?.muted
            ? 0
            : (item?.volume ?? 0);
        r.gain.gain.value = item?.visible ? level : 0;
      }
      if (r.video && !r.stream) {
        r.video.loop = item?.loop ?? true;
        if (!item?.visible) r.video.pause();
        else if (r.video.paused) void r.video.play().catch(() => {});
      }
    }
    for (const item of active.sources) {
      if (!item.visible) continue;
      if (['image', 'video', 'browser'].includes(item.kind)) {
        const signature =
          item.kind === 'browser' ? `${item.value}:${item.width}:${item.height}` : item.value;
        const resource = this.resources.get(item.id);
        if (!resource || resource.signature !== signature) {
          this.release(item.id);
          void this.loadMedia(item, signature).catch((e) =>
            this.onError(`${item.name}: ${String(e)}`),
          );
        }
      }
    }
  }
  private initAudio() {
    if (!this.audio) {
      this.audio = new AudioContext({ sampleRate: 48000 });
      this.destination = this.audio.createMediaStreamDestination();
    }
    if (this.audio.state === 'suspended') void this.audio.resume();
    return this.audio;
  }
  async setMicrophone(deviceId: string) {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.micGain?.disconnect();
    this.micAnalyser?.disconnect();
    this.mic = undefined;
    if (!deviceId) return;
    const ctx = this.initAudio();
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.micSource = ctx.createMediaStreamSource(this.mic);
    this.micGain = ctx.createGain();
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 256;
    this.micGain.gain.value = this.workspace?.microphoneMuted
      ? 0
      : (this.workspace?.microphoneVolume ?? 0.8);
    this.micSource.connect(this.micGain).connect(this.micAnalyser).connect(this.destination!);
  }
  async attachCapture(item: SceneSource, captureId: string) {
    await bridge.selectCapture(captureId);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: this.workspace?.output.fps ?? 30 },
      audio: true,
    });
    this.attachStream(item, stream);
  }
  async attachCamera(item: SceneSource, deviceId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    this.attachStream(item, stream);
  }
  private attachStream(item: SceneSource, stream: MediaStream) {
    this.release(item.id);
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    const r: Resource = { signature: item.value, stream, video };
    this.resources.set(item.id, r);
    void video.play().catch((error) => {
      if (!r.disposed && error.name !== 'AbortError')
        this.onError(`${item.name}: ${String(error)}`);
    });
    if (stream.getAudioTracks().length) {
      const ctx = this.initAudio();
      r.audio = ctx.createMediaStreamSource(stream);
      r.gain = ctx.createGain();
      r.analyser = ctx.createAnalyser();
      r.analyser.fftSize = 256;
      r.gain.gain.value = this.workspace?.desktopMuted
        ? 0
        : (this.workspace?.desktopVolume ?? 0.75);
      r.audio.connect(r.gain).connect(r.analyser).connect(this.destination!);
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.release(item.id);
      this.onError(`${item.name}: sdílení obrazu bylo ukončeno. Zdroj můžeš znovu připojit.`);
    });
    // Commit new sources to the scene before the next workspace update.
  }
  hasResource(id: string) {
    return this.resources.has(id);
  }
  private async loadMedia(item: SceneSource, signature: string) {
    const r: Resource = { signature };
    this.resources.set(item.id, r);
    if (item.kind === 'browser') {
      await bridge.browserStart(
        item.id,
        item.value,
        Math.max(32, Math.min(1920, Math.round(item.width))),
        Math.max(32, Math.min(1920, Math.round(item.height))),
      );
      return;
    }
    const url = item.value.startsWith('blob:') ? item.value : await bridge.restoreAsset(item.value);
    if (r.disposed) return;
    if (!url) throw new Error('Soubor není dostupný. Vyber ho znovu.');
    if (item.kind === 'image') {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
      await image.decode();
      if (!r.disposed) r.image = image;
    } else {
      const ctx = this.initAudio();
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = url;
      video.loop = item.loop;
      video.playsInline = true;
      r.video = video;
      r.audio = ctx.createMediaElementSource(video);
      r.gain = ctx.createGain();
      r.gain.gain.value = item.muted ? 0 : item.volume;
      r.audio.connect(r.gain).connect(this.destination!);
      await video.play();
      if (!r.disposed && this.workspace) this.update(this.workspace);
    }
  }
  private release(id: string) {
    const r = this.resources.get(id);
    if (!r) return;
    r.disposed = true;
    r.stream?.getTracks().forEach((t) => t.stop());
    r.video?.pause();
    if (r.video) {
      r.video.srcObject = null;
      r.video.removeAttribute('src');
      r.video.load();
    }
    r.audio?.disconnect();
    r.gain?.disconnect();
    r.analyser?.disconnect();
    this.resources.delete(id);
    this.frames.delete(id);
    void bridge.browserStop(id).catch(() => {});
  }
  private draw = (time: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.draw);
    const w = this.workspace;
    if (!w || time - this.lastFrame < 1000 / w.output.fps - 1) return;
    this.lastFrame = time;
    const ctx = this.context;
    const scene = w.scenes.find((s) => s.id === w.activeSceneId)!;
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const item of scene.sources) {
      if (!item.visible) continue;
      ctx.save();
      ctx.globalAlpha = item.opacity;
      ctx.beginPath();
      ctx.rect(item.x, item.y, item.width, item.height);
      ctx.clip();
      if (item.kind === 'color') {
        ctx.fillStyle = item.color;
        ctx.fillRect(item.x, item.y, item.width, item.height);
      } else if (item.kind === 'text') {
        ctx.fillStyle = item.color;
        ctx.font = `700 ${item.fontSize}px Inter, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        const lines: string[] = [];
        for (const paragraph of item.value.split('\n')) {
          let line = '';
          for (const word of paragraph.split(' ')) {
            const candidate = line ? line + ' ' + word : word;
            if (ctx.measureText(candidate).width > item.width && line) {
              lines.push(line);
              line = word;
            } else line = candidate;
          }
          lines.push(line);
        }
        lines.forEach((line, index) =>
          ctx.fillText(line, item.x, item.y + index * item.fontSize * 1.15),
        );
      } else if (item.kind === 'alerts') {
        if (w.showAlerts && this.alert && time < this.alertUntil)
          this.drawAlert(ctx, item, this.alert);
      } else {
        const r = this.resources.get(item.id);
        const media = r?.video ?? r?.image ?? this.frames.get(item.id);
        const width = media instanceof HTMLVideoElement ? media.videoWidth : media?.naturalWidth;
        const height = media instanceof HTMLVideoElement ? media.videoHeight : media?.naturalHeight;
        if (media && width && height) {
          const scale =
            item.fit === 'cover'
              ? Math.max(item.width / width, item.height / height)
              : Math.min(item.width / width, item.height / height);
          ctx.drawImage(
            media,
            item.x + (item.width - width * scale) / 2,
            item.y + (item.height - height * scale) / 2,
            width * scale,
            height * scale,
          );
        } else if (
          (item.kind === 'screen' || item.kind === 'camera') &&
          !this.streamJob &&
          !this.recordingJob
        ) {
          ctx.fillStyle = '#1b272e';
          ctx.fillRect(item.x, item.y, item.width, item.height);
          ctx.fillStyle = '#789097';
          ctx.font = `500 ${Math.max(18, item.width / 28)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(
            'Připoj ' + (item.kind === 'screen' ? 'obrazovku' : 'kameru'),
            item.x + item.width / 2,
            item.y + item.height / 2,
          );
          ctx.textAlign = 'left';
        }
      }
      ctx.restore();
    }
    if (time - this.lastMeter > 100) {
      this.lastMeter = time;
      let desktop = 0;
      for (const r of this.resources.values()) desktop = Math.max(desktop, this.level(r.analyser));
      this.onMeters(this.level(this.micAnalyser), desktop);
    }
  };
  private level(analyser?: AnalyserNode) {
    if (!analyser) return 0;
    const buffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const x of buffer) sum += ((x - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buffer.length) * 3);
  }
  private drawAlert(ctx: CanvasRenderingContext2D, item: SceneSource, alert: StreamAlert) {
    ctx.fillStyle = '#102e25';
    ctx.fillRect(item.x, item.y, item.width, item.height);
    ctx.fillStyle = '#81e8ba';
    ctx.fillRect(item.x, item.y, 6, item.height);
    ctx.font = `600 ${Math.min(32, item.height / 4)}px Inter, sans-serif`;
    ctx.fillText(`${alert.test ? '[TEST] ' : ''}${alert.title}`, item.x + 30, item.y + 24);
    ctx.font = `700 ${Math.min(42, item.height / 3)}px Inter, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(alert.user + (alert.detail ? ' · ' + alert.detail : ''), item.x + 30, item.y + 75);
  }
  showAlert(alert: StreamAlert) {
    this.alert = alert;
    this.alertUntil = performance.now() + 7000;
    if (this.workspace?.alertSound) {
      const ctx = this.initAudio();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      oscillator.connect(gain);
      gain.connect(this.destination!);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.25);
    }
  }
  private createRecorder(
    write: (bytes: Uint8Array) => Promise<void>,
    kind: 'stream' | 'recording',
  ): RecorderJob {
    this.initAudio();
    const video = this.canvas.captureStream(this.workspace?.output.fps ?? 30);
    const composite = new MediaStream([
      ...video.getVideoTracks(),
      ...this.destination!.stream.getAudioTracks(),
    ]);
    const mimeType = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Systém nepodporuje WebM nahrávání.');
    const recorder = new MediaRecorder(composite, {
      mimeType,
      videoBitsPerSecond: Math.max(8000000, (this.workspace?.output.bitrate ?? 6000) * 2000),
      audioBitsPerSecond: 192000,
    });
    const job: RecorderJob = {
      recorder,
      queue: Promise.resolve(),
      queued: 0,
      failed: false,
      tracks: video.getTracks(),
    };
    const fail = (message: string) => {
      if (job.failed) return;
      job.failed = true;
      this.onError(message);
      if (recorder.state !== 'inactive') recorder.stop();
      job.tracks.forEach((t) => t.stop());
      if (kind === 'stream') {
        this.streamJob = undefined;
        void bridge.streamStop();
      } else {
        this.recordingJob = undefined;
        void bridge.recordingStop();
      }
    };
    recorder.ondataavailable = (event) => {
      if (!event.data.size || job.failed) return;
      job.queued += event.data.size;
      if (job.queued > 32 * 1024 * 1024) {
        fail('Enkodér nestíhá. Výstup byl zastaven. Sniž rozlišení nebo FPS.');
        return;
      }
      job.queue = job.queue
        .then(async () => {
          if (!job.failed) await write(new Uint8Array(await event.data.arrayBuffer()));
        })
        .catch((e) => fail(String(e)))
        .finally(() => {
          job.queued -= event.data.size;
        });
    };
    recorder.onerror = () => fail('Snímání výstupu selhalo.');
    recorder.start(500);
    return job;
  }
  async startStream() {
    if (this.streamJob) throw new Error('Stream už běží.');
    if (!this.workspace) return;
    await bridge.streamStart(this.workspace.output);
    try {
      this.streamJob = this.createRecorder((bytes) => bridge.streamChunk(bytes), 'stream');
    } catch (error) {
      await bridge.streamStop();
      throw error;
    }
  }
  private async stopRecorder(job?: RecorderJob) {
    if (!job) return;
    if (job.recorder.state !== 'inactive')
      await new Promise<void>((resolve) => {
        job.recorder.addEventListener('stop', () => resolve(), { once: true });
        job.recorder.stop();
      });
    await job.queue;
    job.tracks.forEach((t) => t.stop());
  }
  async stopStream() {
    const job = this.streamJob;
    this.streamJob = undefined;
    await this.stopRecorder(job);
    await bridge.streamStop();
  }
  async startRecording() {
    if (this.recordingJob) throw new Error('Nahrávání už běží.');
    const path = await bridge.recordingStart();
    if (!path) return null;
    try {
      this.recordingJob = this.createRecorder((bytes) => bridge.recordingChunk(bytes), 'recording');
      return path;
    } catch (e) {
      await bridge.recordingStop();
      throw e;
    }
  }
  async stopRecording() {
    const job = this.recordingJob;
    this.recordingJob = undefined;
    await this.stopRecorder(job);
    await bridge.recordingStop();
  }
  get isRecording() {
    return !!this.recordingJob && this.recordingJob.recorder.state === 'recording';
  }
  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    for (const id of [...this.resources.keys()]) this.release(id);
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.audio?.close();
  }
}
