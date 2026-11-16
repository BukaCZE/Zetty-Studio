import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  protocol,
  session,
  net,
  shell,
  Menu,
  powerSaveBlocker,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename, extname, resolve } from 'node:path';
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { z } from 'zod';
import { platformSchema, accountPatchSchema, outputSchema } from '../shared/validation.js';
import { type BridgeEvent } from '../shared/types.js';
import { Vault } from './vault.js';
import { Auth } from './auth.js';
import { Platforms } from './platforms.js';
import { StreamEngine } from './streaming.js';

const here = dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged && process.argv.includes('--dev');
const smoke = process.argv.includes('--smoke-test');
app.setName('Zetty Studio');
// Retain the original profile and installer identity so a rename preserves accounts and scenes.
app.setPath('userData', join(app.getPath('appData'), 'streamnest-studio'));
if (smoke) app.setPath('userData', join(app.getPath('temp'), 'streamnest-smoke-' + process.pid));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'streamnest',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
app.setAppUserModelId('studio.streamnest.app');
let window: BrowserWindow;
let vault: Vault;
let auth: Auth;
let platforms: Platforms;
let stream: StreamEngine;
let capture: string | undefined;
let captureExpires = 0;
let recording: WriteStream | undefined;
let blocker: number | undefined;
const browsers = new Map<string, BrowserWindow>();
const assets = new Map<string, string>();
const approvedPaths = new Set<string>();
let approvedPathFile = '';
const emit = (event: BridgeEvent) => {
  if (window && !window.isDestroyed()) window.webContents.send('studio:event', event);
};
function handle(name: string, fn: (...args: any[]) => any) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Nepovolený odesílatel.');
    return fn(...args);
  });
}
function assetUrl(path: string) {
  const id = randomUUID();
  assets.set(id, path);
  return `streamnest://asset/${id}`;
}
function lockPower() {
  if (blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
}
function unlockPower() {
  if (!recording && !stream.active && blocker !== undefined) {
    powerSaveBlocker.stop(blocker);
    blocker = undefined;
  }
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    vault = new Vault();
    auth = new Auth(vault, emit);
    platforms = new Platforms(vault, auth, emit);
    stream = new StreamEngine(vault, (data) => {
      emit({ type: 'stream', data });
      if (data.state === 'idle' || data.state === 'error') unlockPower();
    });
    approvedPathFile = join(app.getPath('userData'), 'approved-assets.json');
    if (existsSync(approvedPathFile)) {
      try {
        for (const p of JSON.parse(readFileSync(approvedPathFile, 'utf8')))
          if (typeof p === 'string') approvedPaths.add(p);
      } catch {}
    }
    protocol.handle('streamnest', async (request) => {
      const url = new URL(request.url);
      const path = assets.get(url.pathname.slice(1));
      if (url.hostname !== 'asset' || !path) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(path).href, { headers: request.headers });
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
    window = new BrowserWindow({
      width: 1540,
      height: 980,
      minWidth: 1100,
      minHeight: 760,
      backgroundColor: '#191a17',
      title: 'Zetty Studio',
      icon: join(here, '../../build/icon.png'),
      show: false,
      webPreferences: {
        preload: join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        webSecurity: true,
      },
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => app.quit());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const ses = session.defaultSession;
    ses.setPermissionCheckHandler(
      (contents, permission) =>
        contents === window.webContents && ['media', 'display-capture'].includes(permission),
    );
    ses.setPermissionRequestHandler((contents, permission, callback) =>
      callback(
        contents === window.webContents && ['media', 'display-capture'].includes(permission),
      ),
    );
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      const id = capture;
      capture = undefined;
      if (request.frame !== window.webContents.mainFrame || !id || Date.now() > captureExpires) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const source = sources.find((s) => s.id === id);
        if (!source) {
          callback({});
          return;
        }
        callback({
          video: source,
          ...(request.audioRequested && process.platform === 'win32'
            ? { audio: 'loopback' as const }
            : {}),
        });
      } catch {
        callback({});
      }
    });
    handle('app:bootstrap', () => vault.view());
    handle('settings:account', (raw) => {
      if (stream.active) throw new Error('Nastavení cíle lze změnit po zastavení streamu.');
      const patch = accountPatchSchema.parse(raw);
      const a = vault.data.accounts[patch.platform];
      if (patch.clientId !== undefined && patch.clientId !== a.clientId && a.accessToken)
        throw new Error('Před změnou Client ID odpoj účet.');
      for (const key of ['clientId', 'serverUrl', 'enabled'] as const)
        if (patch[key] !== undefined) Object.assign(a, { [key]: patch[key] });
      if (patch.clientSecret) a.clientSecret = patch.clientSecret;
      if (patch.streamKey) a.streamKey = patch.streamKey;
      vault.save();
      return vault.view();
    });
    handle('settings:relay', (url, token) => {
      const value = z.string().max(2048).parse(url).trim();
      if (value) {
        const parsed = new URL(value);
        if (
          !(
            parsed.protocol === 'https:' ||
            (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))
          ) ||
          parsed.username ||
          parsed.password
        )
          throw new Error('Relay vyžaduje HTTPS, lokálně HTTP na localhost.');
      }
      vault.data.relayUrl = value;
      if (token) vault.data.relayToken = z.string().max(4096).parse(token);
      vault.save();
      void platforms.refresh();
      return vault.view();
    });
    handle('auth:connect', async (p) => {
      await auth.connect(platformSchema.parse(p));
      await platforms.refresh();
    });
    handle('auth:disconnect', async (p) => {
      const platform = platformSchema.parse(p);
      await auth.disconnect(platform);
      platforms.disconnected(platform);
    });
    handle('platforms:refresh', () => platforms.refresh());
    handle('chat:send', (p, text) =>
      platforms.sendChat(platformSchema.parse(p), z.string().min(1).max(500).parse(text)),
    );
    handle('capture:list', async () =>
      (
        await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: false,
        })
      ).map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })),
    );
    handle('capture:select', (id) => {
      capture = z.string().max(200).parse(id);
      captureExpires = Date.now() + 15000;
    });
    handle('asset:pick', async (kind) => {
      z.enum(['image', 'video']).parse(kind);
      const result = await dialog.showOpenDialog(window, {
        title: 'Vybrat zdroj',
        properties: ['openFile'],
        filters: [
          {
            name: kind === 'image' ? 'Obrázky' : 'Videa',
            extensions:
              kind === 'image'
                ? ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
                : ['mp4', 'webm', 'mov', 'mkv'],
          },
        ],
      });
      if (result.canceled) return null;
      const path = resolve(result.filePaths[0]);
      approvedPaths.add(path);
      writeFileSync(approvedPathFile, JSON.stringify([...approvedPaths]));
      return { id: randomUUID(), name: basename(path), path, url: assetUrl(path) };
    });
    handle('asset:restore', (raw) => {
      const path = resolve(z.string().max(4096).parse(raw));
      return approvedPaths.has(path) && existsSync(path) ? assetUrl(path) : null;
    });
    handle('browser:start', async (rawId, rawUrl, w, h) => {
      const id = z.string().max(100).parse(rawId);
      const url = new URL(z.string().url().max(4096).parse(rawUrl));
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Webový zdroj vyžaduje HTTP/HTTPS URL.');
      const width = z.number().int().min(32).max(1920).parse(w);
      const height = z.number().int().min(32).max(1920).parse(h);
      browsers.get(id)?.destroy();
      if (browsers.size >= 8) throw new Error('Maximálně 8 webových zdrojů.');
      const browser = new BrowserWindow({
        width,
        height,
        show: false,
        transparent: true,
        webPreferences: {
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: `browser-${id}`,
          backgroundThrottling: false,
        },
      });
      browsers.set(id, browser);
      browser.webContents.session.setPermissionRequestHandler((_c, _p, cb) => cb(false));
      browser.webContents.session.setPermissionCheckHandler(() => false);
      browser.webContents.session.on('will-download', (e) => e.preventDefault());
      browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      browser.webContents.on('will-navigate', (event, next) => {
        if (!/^https?:\/\//.test(next)) event.preventDefault();
      });
      browser.webContents.setFrameRate(15);
      browser.webContents.on('paint', (_e, _dirty, img) =>
        emit({ type: 'browser-frame', data: { id, image: img.toDataURL() } }),
      );
      await browser.loadURL(url.href).catch((e) => {
        browser.destroy();
        browsers.delete(id);
        throw e;
      });
    });
    handle('browser:stop', (raw) => {
      const id = z.string().max(100).parse(raw);
      browsers.get(id)?.destroy();
      browsers.delete(id);
    });
    handle('stream:encoders', () => stream.encoders());
    handle('stream:start', async (raw) => {
      await stream.start(outputSchema.parse(raw));
      lockPower();
    });
    handle('stream:chunk', (bytes) => stream.write(bytes));
    handle('stream:stop', async () => {
      await stream.stop();
      unlockPower();
    });
    handle('recording:start', async () => {
      if (recording) throw new Error('Nahrávání už běží.');
      const result = await dialog.showSaveDialog(window, {
        title: 'Uložit záznam',
        defaultPath: join(
          app.getPath('videos'),
          `Zetty-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
        ),
        filters: [{ name: 'WebM video', extensions: ['webm'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const file = createWriteStream(result.filePath);
      await new Promise<void>((res, rej) => {
        file.once('open', () => res());
        file.once('error', rej);
      });
      file.on('error', () =>
        emit({ type: 'notice', data: 'Zápis záznamu selhal. Zkontroluj místo na disku.' }),
      );
      recording = file;
      lockPower();
      return result.filePath;
    });
    handle('recording:chunk', async (bytes) => {
      if (!recording || !(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1024 * 1024)
        throw new Error('Záznam není připraven.');
      const file = recording;
      await new Promise<void>((res, rej) =>
        file.write(Buffer.from(bytes), (err) =>
          err ? rej(new Error('Záznam se nepodařilo uložit.')) : res(),
        ),
      );
    });
    handle('recording:stop', async () => {
      const file = recording;
      recording = undefined;
      if (file)
        await new Promise<void>((res, rej) => {
          file.once('error', rej);
          file.end(res);
        });
      unlockPower();
    });
    handle('app:external', async (raw) => {
      const url = new URL(z.string().url().max(4096).parse(raw));
      if (url.protocol !== 'https:') throw new Error('Povolené jsou pouze HTTPS odkazy.');
      await shell.openExternal(url.href);
    });
    window.on('close', (event) => {
      if (stream.active || recording) {
        const answer = dialog.showMessageBoxSync(window, {
          type: 'question',
          title: 'Probíhá vysílání nebo nahrávání',
          message: 'Ukončit aplikaci a zastavit přenos i záznam?',
          buttons: ['Pokračovat v aplikaci', 'Ukončit'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer === 0) event.preventDefault();
      }
    });
    if (dev) await window.loadURL('http://127.0.0.1:5173');
    else await window.loadFile(join(here, '../../dist/index.html'));
    platforms.start();
  })
  .catch((error) => {
    dialog.showErrorBox('Zetty se nepodařilo spustit', String(error));
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  auth?.dispose();
  platforms?.dispose();
  stream?.dispose();
  recording?.end();
  for (const browser of browsers.values()) browser.destroy();
});
