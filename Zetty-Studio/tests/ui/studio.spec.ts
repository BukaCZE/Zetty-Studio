import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const ffmpeg: string = require('ffmpeg-static');
let application: ElectronApplication;
let page: Page;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await mkdir('.local', { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    ...(process.env.STUDIO_EXECUTABLE ? { executablePath: process.env.STUDIO_EXECUTABLE } : {}),
    args: [
      ...(process.env.STUDIO_EXECUTABLE ? [] : ['.']),
      '--smoke-test',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env,
  });
  page = await application.firstWindow();
  await page.setViewportSize({ width: 1500, height: 950 });
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Režie', exact: true })).toBeVisible();
});
test.afterAll(async () => {
  await application?.close();
});
test('desktop bridge, scenes, sources and project persistence', async () => {
  const info = await page.evaluate(() => window.studio!.bootstrap());
  expect(info.desktop).toBe(true);
  const brand = await application.evaluate(({ app, BrowserWindow }) => ({
    name: app.getName(),
    title: BrowserWindow.getAllWindows()[0].getTitle(),
  }));
  expect(brand).toEqual({ name: 'Zetty Studio', title: 'Zetty Studio' });
  expect(info.accounts).toHaveLength(4);
  expect(JSON.stringify(info)).not.toContain('accessToken');
  await page.screenshot({ path: '.local/studio.png', fullPage: true });
  await page.getByRole('button', { name: 'Přidat scénu', exact: true }).click();
  await page.getByLabel('Název scény').fill('Test scény');
  await page.getByRole('button', { name: 'Uložit scénu' }).click();
  await expect(page.locator('.active-scene-name')).toHaveText('Test scény');
  await page.getByRole('button', { name: 'Přidat zdroj', exact: true }).first().click();
  await page.getByRole('button', { name: 'Text Nadpis, odkaz nebo vlastní zpráva' }).click();
  await page.getByLabel('Název zdroje').fill('Testovací titulek');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Skutečný obraz ze scény');
  await page.getByRole('button', { name: 'Přidat zdroj', exact: true }).last().click();
  await expect(page.locator('.source-name', { hasText: 'Testovací titulek' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.active-scene-name')).toHaveText('Test scény');
  await expect(page.locator('.source-name', { hasText: 'Testovací titulek' })).toBeVisible();
  await page.screenshot({ path: '.local/scene-editor.png', fullPage: true });
});
test('microphone, synthetic camera and real WebM recording', async () => {
  const capture = await page.evaluate(async () => {
    const choices = await window.studio!.captures();
    const own = choices.find((s) => s.name.includes('Zetty'));
    if (!own) throw new Error('App window was not offered for capture');
    await window.studio!.selectCapture(own.id);
    const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = media.getVideoTracks()[0].getSettings();
    const audio = media.getAudioTracks().length;
    media.getTracks().forEach((t) => t.stop());
    return { width: video.width, audio };
  });
  expect(capture.width).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Připojit mikrofon', exact: true }).click();
  await expect(page.locator('.device-select')).toBeVisible();
  await page.getByRole('button', { name: 'Přidat zdroj', exact: true }).first().click();
  await page.getByRole('button', { name: 'Kamera Webkamera nebo virtuální kamera' }).click();
  await expect(
    page.getByRole('button', { name: 'Přidat zdroj', exact: true }).last(),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Přidat zdroj', exact: true }).last().click();
  const outputPath = resolve('.local/recording.webm');
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, outputPath);
  await page.getByRole('button', { name: 'Nahrávat', exact: true }).click();
  await expect(page.locator('.record-button')).toHaveClass(/recording/);
  await page.waitForTimeout(4000);
  await page.locator('.record-button').click();
  await expect(page.locator('.record-button')).not.toHaveClass(/recording/);
  expect((await stat(outputPath)).size).toBeGreaterThan(5000);
  await new Promise<void>((res, rej) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-ss',
        '1',
        '-i',
        outputPath,
        '-frames:v',
        '1',
        '-y',
        resolve('.local/recorded-frame.png'),
      ],
      { windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.once('error', rej);
    child.once('close', (code) => (code === 0 ? res() : rej(new Error(stderr))));
  });
});
test('local assets remain recordable and sandboxed web sources render', async () => {
  const imagePath = resolve('build/icon.png');
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, imagePath);
  const usable = await page.evaluate(async () => {
    const asset = await window.studio!.pickAsset('image');
    if (!asset) throw new Error('Asset not selected');
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = asset.url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    canvas.toDataURL();
    const stream = canvas.captureStream();
    stream.getTracks().forEach((t) => t.stop());
    return asset.url;
  });
  expect(usable).toMatch(/^streamnest:\/\/asset\//);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="background:#1ca75a"><h1>Local browser source</h1></body></html>');
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as { port: number }).port;
  try {
    const frame = await page.evaluate(async (port) => {
      return new Promise<number>((resolve, reject) => {
        const stop = window.studio!.onEvent((event) => {
          if (event.type === 'browser-frame' && (event.data as any).id === 'browser-test') {
            clearTimeout(timeout);
            stop();
            resolve((event.data as any).image.length);
          }
        });
        const timeout = setTimeout(() => {
          stop();
          reject(new Error('No offscreen browser image'));
        }, 10000);
        window
          .studio!.browserStart('browser-test', `http://127.0.0.1:${port}`, 320, 180)
          .catch(reject);
      });
    }, port);
    expect(frame).toBeGreaterThan(100);
  } finally {
    await page.evaluate(() => window.studio!.browserStop('browser-test'));
    server.closeAllConnections();
    await new Promise<void>((res) => server.close(() => res()));
  }
});
test('FFmpeg sends real audio/video to two local RTMP receivers', async () => {
  const port = 19387;
  const file = resolve('.local/received.flv');
  let receiverError = '';
  const receiver = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-listen',
      '1',
      '-i',
      `rtmp://127.0.0.1:${port}/live/test`,
      '-c',
      'copy',
      '-y',
      file,
    ],
    { windowsHide: true },
  );
  const secondFile = resolve('.local/received-second.flv');
  const second = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-listen',
      '1',
      '-i',
      `rtmp://127.0.0.1:${port + 1}/live/test`,
      '-c',
      'copy',
      '-y',
      secondFile,
    ],
    { windowsHide: true },
  );
  receiver.stderr.on('data', (data) => (receiverError += data));
  await page.waitForTimeout(1000);
  await page.evaluate(async (port) => {
    await window.studio!.saveAccount({
      platform: 'twitch',
      serverUrl: `rtmp://127.0.0.1:${port}/live`,
      streamKey: 'test',
      enabled: true,
    });
    await window.studio!.saveAccount({
      platform: 'youtube',
      serverUrl: `rtmp://127.0.0.1:${port + 1}/live`,
      streamKey: 'test',
      enabled: true,
    });
  }, port);
  await page.getByRole('button', { name: 'Spustit stream', exact: true }).click();
  await expect(page.locator('.preview-badge')).toHaveText('VÝSTUP', { timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Ukončit stream', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spustit stream', exact: true })).toBeEnabled({
    timeout: 15000,
  });
  if (receiver.exitCode === null) {
    const closed = new Promise<void>((res) => receiver.once('close', () => res()));
    const kill = setTimeout(() => receiver.kill(), 6000);
    await closed;
    clearTimeout(kill);
  }
  expect((await stat(file)).size, receiverError).toBeGreaterThan(5000);
  second.kill();
  expect((await stat(secondFile)).size).toBeGreaterThan(5000);
  await new Promise<void>((res, rej) => {
    const child = spawn(
      ffmpeg,
      ['-v', 'error', '-i', file, '-frames:v', '1', '-y', resolve('.local/streamed-frame.png')],
      { windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.once('error', rej);
    child.once('close', (code) => (code === 0 ? res() : rej(new Error(stderr))));
  });
});
test('settings, connection screens, empty chat and explicit test alerts', async () => {
  await page.getByRole('button', { name: 'Platformy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Připojení a výstupy' })).toBeVisible();
  await page.screenshot({ path: '.local/accounts.png', fullPage: true });
  await page.getByRole('button', { name: 'Nastavení', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Obraz a vysílání', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/settings.png', fullPage: true });
  await page
    .locator('nav')
    .getByRole('button', { name: /Studio/ })
    .click();
  await page.getByRole('button', { name: 'Spustit testovací alert' }).click();
  await expect(page.locator('.test-badge')).toHaveText('TEST');
  expect(errors).toEqual([]);
});
