// Explicit download with native fetch, timeout and upstream checksum verification.
// This also supports npm versions that defer dependency install scripts.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('node_modules/electron');
const require = createRequire(join(root, 'install.js'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const executable =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron';
if (!existsSync(join(root, 'dist', executable))) {
  const { downloadArtifact } = await import(pathToFileURL(require.resolve('@electron/get')).href);
  console.log(`Downloading Electron ${pkg.version} with checksum validation…`);
  const checksums = JSON.parse(await readFile(join(root, 'checksums.json'), 'utf8'));
  const zip = await downloadArtifact({
    version: pkg.version,
    platform: process.platform,
    arch: process.arch,
    artifactName: 'electron',
    checksums,
    downloader: {
      async download(url, path) {
        const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
        const length = Number(head.headers.get('content-length'));
        if (!head.ok || !length) throw new Error(`Electron download: HTTP ${head.status}`);
        // Bounded range requests work on slower connections without one long-lived transfer.
        const file = await open(path, 'w');
        const size = 4 * 1024 * 1024;
        let next = 0;
        let complete = 0;
        try {
          await Promise.all(
            Array.from({ length: 4 }, async () => {
              while (next < length) {
                const start = next;
                next += size;
                const end = Math.min(length - 1, start + size - 1);
                const response = await fetch(head.url, {
                  headers: { Range: `bytes=${start}-${end}` },
                  signal: AbortSignal.timeout(60000),
                });
                if (response.status !== 206)
                  throw new Error(`Electron range download: HTTP ${response.status}`);
                const bytes = Buffer.from(await response.arrayBuffer());
                if (bytes.length !== end - start + 1)
                  throw new Error('Incomplete Electron download range');
                let offset = 0;
                while (offset < bytes.length) {
                  const { bytesWritten } = await file.write(
                    bytes,
                    offset,
                    bytes.length - offset,
                    start + offset,
                  );
                  offset += bytesWritten;
                }
                complete += bytes.length;
                if (complete % (16 * 1024 * 1024) === 0 || complete === length)
                  console.log(`Electron: ${Math.round((complete / length) * 100)} %`);
              }
            }),
          );
        } finally {
          await file.close();
        }
      },
    },
  });
  const { extract } = require('@electron-internal/extract-zip');
  await mkdir(join(root, 'dist'), { recursive: true });
  await extract(zip, { dir: join(root, 'dist') });
}
await writeFile(join(root, 'path.txt'), executable);
