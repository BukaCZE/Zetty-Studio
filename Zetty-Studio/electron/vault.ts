import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { platformIds, type Platform, type AccountView, type AppSettings } from '../shared/types.js';

export interface Account {
  clientId: string;
  clientSecret: string;
  serverUrl: string;
  streamKey: string;
  enabled: boolean;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  name: string;
}
interface VaultData {
  accounts: Record<Platform, Account>;
  relayUrl: string;
  relayToken: string;
}
const servers: Record<Platform, string> = {
  twitch: 'rtmp://live.twitch.tv/app',
  youtube: 'rtmps://a.rtmps.youtube.com/live2',
  kick: '',
  tiktok: '',
};
export class Vault {
  data: VaultData;
  private path: string;
  stats: Partial<
    Record<
      Platform,
      { viewers: number | null; live: boolean; updatedAt: number | null; error?: string }
    >
  > = {};
  constructor() {
    mkdirSync(app.getPath('userData'), { recursive: true });
    this.path = join(app.getPath('userData'), 'credentials.enc');
    this.data = {
      accounts: Object.fromEntries(
        platformIds.map((p) => [
          p,
          {
            clientId: '',
            clientSecret: '',
            serverUrl: servers[p],
            streamKey: '',
            enabled: false,
            accessToken: '',
            refreshToken: '',
            expiresAt: 0,
            userId: '',
            name: '',
          },
        ]),
      ) as Record<Platform, Account>,
      relayUrl: '',
      relayToken: '',
    };
    if (existsSync(this.path)) {
      try {
        const saved = JSON.parse(safeStorage.decryptString(readFileSync(this.path)));
        this.data = {
          ...this.data,
          ...saved,
          accounts: { ...this.data.accounts, ...saved.accounts },
        };
      } catch {
        throw new Error(
          'Nelze otevřít šifrované přihlašovací údaje. Obnov původní profil Windows, nebo přejmenuj soubor credentials.enc v datech aplikace.',
        );
      }
    }
  }
  save() {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Systémové šifrování není dostupné. Přihlašovací údaje nebyly uloženy.');
    const temp = this.path + '.tmp';
    writeFileSync(temp, safeStorage.encryptString(JSON.stringify(this.data)), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  view(): AppSettings {
    const accounts: AccountView[] = platformIds.map((platform) => {
      const a = this.data.accounts[platform];
      return {
        platform,
        clientId: a.clientId,
        hasClientSecret: !!a.clientSecret,
        serverUrl: a.serverUrl,
        hasStreamKey: !!a.streamKey,
        enabled: a.enabled,
        connected: !!a.accessToken,
        name: a.name,
        viewers: null,
        live: false,
        updatedAt: null,
        ...this.stats[platform],
      };
    });
    return {
      accounts,
      relayUrl: this.data.relayUrl,
      hasRelayToken: !!this.data.relayToken,
      version: app.getVersion(),
      desktop: true,
    };
  }
}
