export const platformIds = ['twitch', 'youtube', 'kick', 'tiktok'] as const;
export type Platform = (typeof platformIds)[number];
export const platformNames: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick',
  tiktok: 'TikTok',
};
export interface AccountView {
  platform: Platform;
  clientId: string;
  hasClientSecret: boolean;
  serverUrl: string;
  hasStreamKey: boolean;
  enabled: boolean;
  connected: boolean;
  name: string;
  viewers: number | null;
  live: boolean;
  updatedAt: number | null;
  error?: string;
}
export interface AccountPatch {
  platform: Platform;
  clientId?: string;
  clientSecret?: string;
  serverUrl?: string;
  streamKey?: string;
  enabled?: boolean;
}
export interface AppSettings {
  accounts: AccountView[];
  relayUrl: string;
  hasRelayToken: boolean;
  version: string;
  desktop: boolean;
}
export type SourceKind =
  'screen' | 'camera' | 'image' | 'video' | 'text' | 'color' | 'browser' | 'alerts';
export interface SceneSource {
  id: string;
  name: string;
  kind: SourceKind;
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  value: string;
  color: string;
  fontSize: number;
  deviceId?: string;
  captureName?: string;
  volume: number;
  muted: boolean;
  loop: boolean;
  fit: 'contain' | 'cover';
}
export interface Scene {
  id: string;
  name: string;
  sources: SceneSource[];
  background: string;
}
export type Encoder = 'libx264' | 'h264_nvenc' | 'h264_amf' | 'h264_qsv';
export interface OutputSettings {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  audioBitrate: number;
  encoder: Encoder;
}
export interface Workspace {
  scenes: Scene[];
  activeSceneId: string;
  output: OutputSettings;
  microphoneId: string;
  microphoneVolume: number;
  microphoneMuted: boolean;
  desktopVolume: number;
  desktopMuted: boolean;
  alertSound: boolean;
  showAlerts: boolean;
}
export interface ChatMessage {
  id: string;
  platform: Platform;
  user: string;
  text: string;
  time: number;
  color?: string;
}
export interface StreamAlert {
  id: string;
  platform: Platform;
  user: string;
  title: string;
  detail: string;
  time: number;
  test?: boolean;
}
export interface StreamStatus {
  state: 'idle' | 'starting' | 'live' | 'stopping' | 'error';
  message?: string;
  startedAt?: number;
  fps?: number;
  bitrate?: number;
  targets?: Platform[];
}
export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
}
export interface Asset {
  id: string;
  name: string;
  url: string;
  path: string;
}
export interface BridgeEvent {
  type: 'chat' | 'alert' | 'accounts' | 'stream' | 'auth' | 'browser-frame' | 'notice';
  data: unknown;
}
export interface StudioBridge {
  bootstrap(): Promise<AppSettings>;
  saveAccount(patch: AccountPatch): Promise<AppSettings>;
  saveRelay(url: string, token: string): Promise<AppSettings>;
  connect(platform: Platform): Promise<void>;
  disconnect(platform: Platform): Promise<void>;
  refresh(): Promise<void>;
  sendChat(platform: Platform, text: string): Promise<void>;
  captures(): Promise<CaptureSource[]>;
  selectCapture(id: string): Promise<void>;
  pickAsset(kind: 'image' | 'video'): Promise<Asset | null>;
  restoreAsset(path: string): Promise<string | null>;
  browserStart(id: string, url: string, width: number, height: number): Promise<void>;
  browserStop(id: string): Promise<void>;
  encoders(): Promise<string[]>;
  streamStart(output: OutputSettings): Promise<void>;
  streamChunk(bytes: Uint8Array): Promise<void>;
  streamStop(): Promise<void>;
  recordingStart(): Promise<string | null>;
  recordingChunk(bytes: Uint8Array): Promise<void>;
  recordingStop(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onEvent(fn: (event: BridgeEvent) => void): () => void;
}
