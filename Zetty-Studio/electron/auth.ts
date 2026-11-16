import { shell } from 'electron';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { type Platform, type BridgeEvent } from '../shared/types.js';
import { Vault } from './vault.js';
import { formRequest, jsonRequest } from './http.js';

export class Auth {
  private pending = new Map<Platform, AbortController>();
  private refreshes = new Map<Platform, Promise<string>>();
  private validatedAt = 0;
  constructor(
    private vault: Vault,
    private emit: (event: BridgeEvent) => void,
  ) {}
  async connect(platform: Platform) {
    if (platform === 'tiktok')
      throw new Error(
        'TikTok LIVE vyžaduje přístup přidělený TikTokem. Pro vysílání nastav server a streamovací klíč. Veřejný Login Kit neposkytuje LIVE chat ani počty diváků.',
      );
    if (this.pending.has(platform)) throw new Error('Přihlašování už probíhá v prohlížeči.');
    const account = this.vault.data.accounts[platform];
    if (!account.clientId) throw new Error('Nejdřív v nastavení účtu vyplň OAuth Client ID.');
    if (platform === 'kick' && !account.clientSecret)
      throw new Error(
        'Pro osobní Kick aplikaci vyplň také Client Secret. Nesdílej jej ve veřejném repozitáři.',
      );
    const abort = new AbortController();
    this.pending.set(platform, abort);
    const timeout = setTimeout(() => abort.abort(), 5 * 60 * 1000);
    try {
      let tokens: any;
      if (platform === 'twitch') {
        const scopes =
          'user:read:chat user:write:chat channel:read:stream_key moderator:read:followers channel:read:subscriptions bits:read';
        const device = await formRequest(
          'https://id.twitch.tv/oauth2/device',
          { client_id: account.clientId, scopes },
          abort.signal,
        );
        this.emit({
          type: 'auth',
          data: { platform, code: device.user_code, message: 'Potvrď přihlášení v prohlížeči.' },
        });
        await shell.openExternal(device.verification_uri);
        let interval = Math.max(5, device.interval ?? 5) * 1000;
        while (!abort.signal.aborted) {
          await delay(interval, undefined, { signal: abort.signal });
          try {
            tokens = await formRequest(
              'https://id.twitch.tv/oauth2/token',
              {
                client_id: account.clientId,
                scopes,
                device_code: device.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              },
              abort.signal,
            );
            break;
          } catch (e) {
            const msg = String(e);
            if (msg.includes('slow_down')) interval += 5000;
            else if (!msg.includes('authorization_pending')) throw e;
          }
        }
      } else {
        tokens = await this.browserFlow(platform, abort.signal);
      }
      if (abort.signal.aborted || !tokens?.access_token)
        throw new Error('Přihlášení bylo zrušeno nebo vypršelo.');
      account.accessToken = tokens.access_token;
      account.refreshToken = tokens.refresh_token ?? '';
      account.expiresAt = Date.now() + Number(tokens.expires_in) * 1000;
      try {
        if (platform === 'twitch') {
          const me = await this.request(platform, '/users');
          const user = me.data[0];
          account.userId = user.id;
          account.name = user.display_name;
          const key = await this.request(platform, `/streams/key?broadcaster_id=${user.id}`);
          account.streamKey = key.data[0].stream_key;
        } else if (platform === 'youtube') {
          const me = await this.request(platform, '/channels?part=snippet&mine=true');
          if (!me.items?.length) throw new Error('Tento Google účet nemá YouTube kanál.');
          account.userId = me.items[0].id;
          account.name = me.items[0].snippet.title;
        } else {
          const me = await this.request(platform, '/users');
          const user = me.data[0];
          account.userId = String(user.user_id);
          account.name = user.name;
        }
        if (abort.signal.aborted) throw new Error('Přihlášení bylo zrušeno.');
        this.vault.save();
        this.emit({ type: 'accounts', data: this.vault.view().accounts });
      } catch (error) {
        account.accessToken = '';
        account.refreshToken = '';
        this.vault.save();
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      this.pending.delete(platform);
      this.emit({ type: 'auth', data: null });
    }
  }
  private async browserFlow(platform: 'kick' | 'youtube', signal: AbortSignal) {
    const account = this.vault.data.accounts[platform];
    const state = randomBytes(24).toString('hex');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let server: Server;
    let accept!: (value: string) => void;
    let reject!: (reason: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      accept = res;
      reject = rej;
    });
    // Avoid an unhandled rejection while the system browser is opening.
    void codePromise.catch(() => {});
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('Neplatny OAuth state.');
        return;
      }
      const code = url.searchParams.get('code');
      res.writeHead(code ? 200 : 400, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(
        '<html lang="cs"><title>Zetty</title><body style="background:#101214;color:#e5eee9;font:18px system-ui;padding:60px"><h1>Zetty Studio</h1><p>' +
          (code
            ? 'Přihlášení přijato. Vrať se do aplikace.'
            : 'Přihlášení nebylo povoleno. Vrať se do aplikace.') +
          '</p></body></html>',
      );
      if (code) accept(code);
      else reject(new Error('Přístup nebyl povolen.'));
    });
    const onAbort = () => reject(new Error('Přihlašování bylo zrušeno nebo vypršelo.'));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await new Promise<void>((res, rej) => {
        server.once('error', rej);
        server.listen(platform === 'kick' ? 42817 : 0, '127.0.0.1', res);
      });
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const params = new URLSearchParams({
        client_id: account.clientId,
        response_type: 'code',
        redirect: '127.0.0.1',
        redirect_uri: redirect,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope:
          platform === 'kick'
            ? 'user:read channel:read chat:write events:subscribe'
            : 'https://www.googleapis.com/auth/youtube.force-ssl',
      });
      if (platform === 'youtube') {
        params.set('access_type', 'offline');
        params.set('prompt', 'consent');
      }
      await shell.openExternal(
        (platform === 'kick'
          ? 'https://id.kick.com/oauth/authorize?'
          : 'https://accounts.google.com/o/oauth2/v2/auth?') + params,
      );
      const code = await codePromise;
      const body: Record<string, string> = {
        client_id: account.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      };
      if (account.clientSecret) body.client_secret = account.clientSecret;
      return await formRequest(
        platform === 'kick'
          ? 'https://id.kick.com/oauth/token'
          : 'https://oauth2.googleapis.com/token',
        body,
        signal,
      );
    } finally {
      signal.removeEventListener('abort', onAbort);
      server.closeAllConnections();
      server.close();
    }
  }
  async token(platform: Platform): Promise<string> {
    const a = this.vault.data.accounts[platform];
    if (!a.accessToken) throw new Error('Účet není připojený.');
    if (a.expiresAt > Date.now() + 90000) return a.accessToken;
    const pending = this.refreshes.get(platform);
    if (pending) return pending;
    const refresh = (async () => {
      if (!a.refreshToken) throw new Error('Přihlášení vypršelo. Připoj účet znovu.');
      const originalRefresh = a.refreshToken;
      const originalClient = a.clientId;
      const endpoint =
        platform === 'twitch'
          ? 'https://id.twitch.tv/oauth2/token'
          : platform === 'kick'
            ? 'https://id.kick.com/oauth/token'
            : 'https://oauth2.googleapis.com/token';
      const body: Record<string, string> = {
        client_id: a.clientId,
        grant_type: 'refresh_token',
        refresh_token: a.refreshToken,
      };
      if (a.clientSecret) body.client_secret = a.clientSecret;
      const tokens = await formRequest(endpoint, body);
      if (!a.accessToken || a.refreshToken !== originalRefresh || a.clientId !== originalClient)
        throw new Error('Účet byl mezitím odpojen nebo změněn.');
      a.accessToken = tokens.access_token;
      a.refreshToken = tokens.refresh_token ?? a.refreshToken;
      a.expiresAt = Date.now() + Number(tokens.expires_in) * 1000;
      this.vault.save();
      return a.accessToken;
    })();
    this.refreshes.set(platform, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshes.delete(platform);
    }
  }
  async request(platform: Platform, path: string, init: RequestInit = {}) {
    const a = this.vault.data.accounts[platform];
    const base =
      platform === 'twitch'
        ? 'https://api.twitch.tv/helix'
        : platform === 'kick'
          ? 'https://api.kick.com/public/v1'
          : 'https://www.googleapis.com/youtube/v3';
    const token = await this.token(platform);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (platform === 'twitch') headers['Client-Id'] = a.clientId;
    return jsonRequest(base + path, { ...init, headers });
  }
  async validateTwitch() {
    if (!this.vault.data.accounts.twitch.accessToken || Date.now() - this.validatedAt < 3600000)
      return;
    await jsonRequest('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${await this.token('twitch')}` },
    });
    this.validatedAt = Date.now();
  }
  async disconnect(platform: Platform) {
    this.pending.get(platform)?.abort();
    const a = this.vault.data.accounts[platform];
    // Forget locally even when a remote revoke is unavailable.
    const token = a.accessToken;
    a.accessToken = '';
    a.refreshToken = '';
    a.userId = '';
    a.name = '';
    a.expiresAt = 0;
    delete this.vault.stats[platform];
    this.vault.save();
    if (token && platform === 'twitch')
      await formRequest('https://id.twitch.tv/oauth2/revoke', {
        client_id: a.clientId,
        token,
      }).catch(() => {});
    if (token && platform === 'youtube')
      await formRequest('https://oauth2.googleapis.com/revoke', { token }).catch(() => {});
    if (token && platform === 'kick')
      await formRequest(
        'https://id.kick.com/oauth/revoke?token=' + encodeURIComponent(token),
        {},
      ).catch(() => {});
  }
  dispose() {
    for (const abort of this.pending.values()) abort.abort();
  }
}
