import { useEffect, useState } from 'react';
import {
  Cpu,
  Download,
  FileUp,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  Radio,
  Check,
  ExternalLink,
  Save,
} from 'lucide-react';
import type { AppSettings, Encoder, Workspace } from '../../shared/types';
import { bridge } from '../bridge';
export const encoderNames: Record<Encoder, string> = {
  libx264: 'Procesor · x264',
  h264_nvenc: 'NVIDIA · NVENC',
  h264_amf: 'AMD · AMF',
  h264_qsv: 'Intel · Quick Sync',
};
export function Settings({
  workspace,
  onChange,
  settings,
  onSettings,
  run,
  busy,
  onExport,
  onImport,
}: {
  workspace: Workspace;
  onChange: (w: Workspace) => void;
  settings: AppSettings;
  onSettings: (s: AppSettings) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onExport: () => void;
  onImport: () => void;
}) {
  const [output, setOutput] = useState(workspace.output);
  const [encoders, setEncoders] = useState<string[]>(['libx264']);
  const [relay, setRelay] = useState(settings.relayUrl);
  const [token, setToken] = useState('');
  useEffect(() => {
    void bridge
      .encoders()
      .then(setEncoders)
      .catch(() => {});
  }, []);
  return (
    <div className="settings-layout">
      <div className="settings-main">
        <section className="settings-section">
          <div className="settings-title">
            <SlidersHorizontal size={20} />
            <div>
              <h3>Obraz a vysílání</h3>
              <p>Jedno enkódování pro všechny vybrané platformy.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Rozlišení
              <select
                disabled={busy}
                value={`${output.width}x${output.height}`}
                onChange={(e) => {
                  const [width, height] = e.target.value.split('x').map(Number);
                  setOutput({ ...output, width, height });
                }}
              >
                <option value="1920x1080">1920 × 1080 · Full HD</option>
                <option value="1280x720">1280 × 720 · HD</option>
                <option value="1080x1920">1080 × 1920 · Na výšku</option>
                <option value="720x1280">720 × 1280 · Na výšku</option>
              </select>
            </label>
            <label>
              Snímková frekvence
              <select
                disabled={busy}
                value={output.fps}
                onChange={(e) => setOutput({ ...output, fps: Number(e.target.value) })}
              >
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </label>
            <label>
              Datový tok videa (kb/s)
              <input
                disabled={busy}
                type="number"
                min={1000}
                max={20000}
                step={500}
                value={output.bitrate}
                onChange={(e) => setOutput({ ...output, bitrate: Number(e.target.value) })}
              />
            </label>
            <label>
              Zvuk
              <select
                disabled={busy}
                value={output.audioBitrate}
                onChange={(e) => setOutput({ ...output, audioBitrate: Number(e.target.value) })}
              >
                {[128, 160, 192, 256, 320].map((n) => (
                  <option key={n} value={n}>
                    AAC · {n} kb/s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Enkodér
            <select
              disabled={busy}
              value={output.encoder}
              onChange={(e) => setOutput({ ...output, encoder: e.target.value as Encoder })}
            >
              {Object.entries(encoderNames)
                .filter(([id]) => encoders.includes(id))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
          <p className="form-help">
            GPU enkodér vyžaduje podporovanou kartu a aktuální ovladače. Seznam ukazuje podporu v
            FFmpegu; dostupnost hardwaru se ověří při spuštění. Při potížích zvol procesor.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              if (output.bitrate < 1000 || output.bitrate > 20000) return;
              const sx = output.width / workspace.output.width;
              const sy = output.height / workspace.output.height;
              onChange({
                ...workspace,
                output,
                scenes: workspace.scenes.map((s) => ({
                  ...s,
                  sources: s.sources.map((x) => ({
                    ...x,
                    x: x.x * sx,
                    y: x.y * sy,
                    width: x.width * sx,
                    height: x.height * sy,
                    fontSize: x.fontSize * Math.min(sx, sy),
                  })),
                })),
              });
            }}
          >
            <Check size={16} /> Použít nastavení
          </button>
          {busy && (
            <p className="form-help">Kvalitu lze změnit po zastavení vysílání i nahrávání.</p>
          )}
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <Volume2 size={20} />
            <div>
              <h3>Alerty</h3>
              <p>Upozornění pro tebe i tvé diváky.</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <b>Zvuk upozornění</b>
              <p>Přehraje tón v aplikaci i ve výstupním zvuku.</p>
            </div>
            <button
              className={`switch ${workspace.alertSound ? 'on' : ''}`}
              role="switch"
              aria-checked={workspace.alertSound}
              aria-label="Zvuk upozornění"
              onClick={() => onChange({ ...workspace, alertSound: !workspace.alertSound })}
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <b>Alerty v obrazu</b>
              <p>Vyžaduje zdroj „Alerty Zetty“ ve scéně.</p>
            </div>
            <button
              className={`switch ${workspace.showAlerts ? 'on' : ''}`}
              role="switch"
              aria-checked={workspace.showAlerts}
              aria-label="Alerty v obrazu"
              onClick={() => onChange({ ...workspace, showAlerts: !workspace.showAlerts })}
            >
              <span />
            </button>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <Radio size={20} />
            <div>
              <h3>Kick: příjem událostí</h3>
              <p>Kick doručuje chat a alerty přes veřejný webhook.</p>
            </div>
          </div>
          <p className="form-help">
            Součástí projektu je volitelný relay server. Nasaď ho na svůj HTTPS server, v Kick
            developer konzoli nastav jeho /webhooks/kick URL a sem vlož adresu a token. Server je v
            této verzi určený pro jednoho streamera.
          </p>
          <label>
            Adresa relay serveru
            <input
              value={relay}
              onChange={(e) => setRelay(e.target.value)}
              placeholder="https://relay.example.com"
            />
          </label>
          <label>
            Přístupový token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                settings.hasRelayToken
                  ? 'Uložený · prázdné zachová token'
                  : 'Token z prostředí relay serveru'
              }
              autoComplete="new-password"
            />
          </label>
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                onSettings(await bridge.saveRelay(relay, token));
                setToken('');
              })
            }
          >
            <Save size={16} /> Uložit relay
          </button>
        </section>
      </div>
      <aside className="settings-aside">
        <section className="settings-section">
          <div className="settings-title">
            <Cpu size={20} />
            <h3>Tvůj výstup</h3>
          </div>
          <dl className="output-summary">
            <div>
              <dt>Obraz</dt>
              <dd>
                {workspace.output.width} × {workspace.output.height}
              </dd>
            </div>
            <div>
              <dt>Snímky</dt>
              <dd>{workspace.output.fps} FPS</dd>
            </div>
            <div>
              <dt>Video</dt>
              <dd>{workspace.output.bitrate} kb/s</dd>
            </div>
            <div>
              <dt>Zvuk</dt>
              <dd>{workspace.output.audioBitrate} kb/s</dd>
            </div>
            <div>
              <dt>Enkodér</dt>
              <dd>{encoderNames[workspace.output.encoder]}</dd>
            </div>
          </dl>
          <p className="form-help">
            Upload se násobí počtem platforem. Pro{' '}
            {settings.accounts.filter((a) => a.enabled).length || 2} cíle počítej alespoň s{' '}
            {Math.ceil(
              ((workspace.output.bitrate + workspace.output.audioBitrate) *
                (settings.accounts.filter((a) => a.enabled).length || 2) *
                1.25) /
                1000,
            )}{' '}
            Mb/s stabilního uploadu.
          </p>
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <Download size={20} />
            <h3>Tvoje scény</h3>
          </div>
          <p className="form-help">
            Zálohuj scény a nastavení. Export neobsahuje účty ani klíče. Cesty k místním médiím se
            zachovají.
          </p>
          <button className="button secondary full" onClick={onExport}>
            <Download size={16} /> Exportovat projekt
          </button>
          <button className="button secondary full" disabled={busy} onClick={onImport}>
            <FileUp size={16} /> Importovat projekt
          </button>
        </section>
        <div className="secure-note">
          <ShieldCheck size={22} />
          <p>
            Zetty Studio {settings.version}
            <br />
            Samostatná aplikace. Bez OBS.
          </p>
        </div>
      </aside>
    </div>
  );
}
