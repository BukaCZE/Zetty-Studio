import { platformIds, type AppSettings, type StudioBridge } from '../shared/types';
const unavailable = async (): Promise<never> => {
  throw new Error(
    'Tato funkce vyžaduje desktopovou aplikaci. Spusť Zetty Studio.exe nebo npm run dev.',
  );
};
const preview: StudioBridge = {
  bootstrap: async (): Promise<AppSettings> => ({
    accounts: platformIds.map((platform) => ({
      platform,
      clientId: '',
      hasClientSecret: false,
      serverUrl: '',
      hasStreamKey: false,
      enabled: false,
      connected: false,
      name: '',
      viewers: null,
      live: false,
      updatedAt: null,
    })),
    relayUrl: '',
    hasRelayToken: false,
    desktop: false,
    version: '0.1.1',
  }),
  saveAccount: unavailable,
  saveRelay: unavailable,
  connect: unavailable,
  disconnect: unavailable,
  refresh: async () => {},
  sendChat: unavailable,
  captures: unavailable,
  selectCapture: unavailable,
  pickAsset: unavailable,
  restoreAsset: async () => null,
  browserStart: unavailable,
  browserStop: async () => {},
  encoders: async () => ['libx264'],
  streamStart: unavailable,
  streamChunk: unavailable,
  streamStop: async () => {},
  recordingStart: unavailable,
  recordingChunk: unavailable,
  recordingStop: async () => {},
  openExternal: unavailable,
  onEvent: () => () => {},
};
export const bridge = window.studio ?? preview;
