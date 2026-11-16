import { useState } from 'react';
import {
  AppWindow,
  Bell,
  Camera,
  Check,
  FileVideo,
  Image,
  Monitor,
  Palette,
  Type,
  Globe,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import type { CaptureSource, SceneSource, SourceKind } from '../../shared/types';
import { bridge } from '../bridge';
import { source } from '../workspace';
import { Modal } from './Modal';
export const sourceIcons = {
  screen: Monitor,
  camera: Camera,
  image: Image,
  video: FileVideo,
  text: Type,
  color: Palette,
  browser: Globe,
  alerts: Bell,
};
const kinds: { kind: SourceKind; name: string; description: string }[] = [
  { kind: 'screen', name: 'Obrazovka nebo okno', description: 'Hra, aplikace nebo celý monitor' },
  { kind: 'camera', name: 'Kamera', description: 'Webkamera nebo virtuální kamera' },
  { kind: 'image', name: 'Obrázek', description: 'Logo, pozadí nebo grafický overlay' },
  { kind: 'video', name: 'Video', description: 'Intro, klip nebo videosmyčka' },
  { kind: 'text', name: 'Text', description: 'Nadpis, odkaz nebo vlastní zpráva' },
  { kind: 'browser', name: 'Webový zdroj', description: 'Widget, webová stránka nebo alertbox' },
  { kind: 'color', name: 'Barevná plocha', description: 'Jednoduché pozadí nebo tvar' },
  { kind: 'alerts', name: 'Alerty Zetty', description: 'Upozornění přímo v obrazu' },
];
export function AddSource({
  onClose,
  onAdd,
  run,
  width,
  height,
}: {
  onClose: () => void;
  onAdd: (item: SceneSource, captureId?: string) => Promise<void>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  width: number;
  height: number;
}) {
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [captures, setCaptures] = useState<CaptureSource[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [selection, setSelection] = useState('');
  const [assetPath, setAssetPath] = useState('');
  function choose(next: SourceKind) {
    setKind(next);
    setName(kinds.find((k) => k.kind === next)!.name);
    setValue(next === 'text' ? 'Tvůj text' : next === 'color' ? '#81e8ba' : '');
    if (next === 'screen') {
      setLoading(true);
      void run(async () => {
        const list = await bridge.captures();
        setCaptures(list);
        setSelection(list[0]?.id ?? '');
      }).finally(() => setLoading(false));
    }
    if (next === 'camera') {
      setLoading(true);
      void run(async () => {
        const permission = await navigator.mediaDevices.getUserMedia({ video: true });
        permission.getTracks().forEach((t) => t.stop());
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === 'videoinput',
        );
        setDevices(list);
        setSelection(list[0]?.deviceId ?? 'default');
      }).finally(() => setLoading(false));
    }
  }
  const create = async () => {
    if (!kind) return;
    const item = source(kind, name.trim() || kinds.find((k) => k.kind === kind)!.name, {
      width,
      height,
      value: ['image', 'video'].includes(kind) ? assetPath : value,
    });
    if (kind === 'text')
      Object.assign(item, {
        x: width * 0.08,
        y: height * 0.4,
        width: width * 0.84,
        height: 220,
        fontSize: 72,
      });
    if (kind === 'camera')
      Object.assign(item, {
        x: width * 0.73,
        y: height * 0.69,
        width: width * 0.24,
        height: height * 0.25,
        deviceId: selection,
      });
    if (kind === 'screen') item.captureName = captures.find((s) => s.id === selection)?.name;
    if (kind === 'color') item.color = value;
    if (kind === 'alerts')
      Object.assign(item, { x: width * 0.27, y: height * 0.05, width: width * 0.46, height: 160 });
    if (kind === 'browser') {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Použij HTTP/HTTPS adresu.');
    }
    await onAdd(item, kind === 'screen' ? selection : undefined);
    onClose();
  };
  return (
    <Modal
      title={kind ? `Přidat: ${kinds.find((k) => k.kind === kind)!.name}` : 'Co přidáme do scény?'}
      subtitle={
        kind
          ? 'Zdroj můžeš následně posunout a upravit v náhledu.'
          : 'Poskládej si obraz přesně podle sebe.'
      }
      onClose={onClose}
      wide={!kind || kind === 'screen'}
    >
      {!kind ? (
        <div className="source-kinds">
          {kinds.map((k) => {
            const Icon = sourceIcons[k.kind];
            return (
              <button className="source-kind" key={k.kind} onClick={() => choose(k.kind)}>
                <span>
                  <Icon size={23} />
                </span>
                <div>
                  <b>{k.name}</b>
                  <small>{k.description}</small>
                </div>
                <ArrowRight size={16} />
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <label>
            Název zdroje
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          {loading && <p className="loading">Načítám dostupná zařízení…</p>}
          {kind === 'screen' && (
            <>
              <p className="form-help">
                Zvuk systému se snímá z celého počítače. Pro hru vyber okno; pro exkluzivní
                fullscreen použij bezokrajový režim.
              </p>
              <div className="capture-grid">
                {captures.map((c) => (
                  <button
                    key={c.id}
                    className={`capture-choice ${selection === c.id ? 'selected' : ''}`}
                    onClick={() => setSelection(c.id)}
                  >
                    <img src={c.thumbnail} alt="" />
                    <span>{c.name}</span>
                    {selection === c.id && <Check size={16} />}
                  </button>
                ))}
              </div>
            </>
          )}
          {kind === 'camera' && (
            <label>
              Kamera
              <select value={selection} onChange={(e) => setSelection(e.target.value)}>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Kamera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {['image', 'video'].includes(kind) && (
            <button
              className="file-picker"
              onClick={() =>
                void run(async () => {
                  const asset = await bridge.pickAsset(kind as 'image' | 'video');
                  if (asset) {
                    setAssetPath(asset.path);
                    setName(asset.name);
                  }
                })
              }
            >
              <FolderOpen size={26} />
              {assetPath ? assetPath.split(/[\\/]/).pop() : 'Vybrat soubor z počítače'}
            </button>
          )}
          {kind === 'text' && (
            <label>
              Text
              <textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          {kind === 'browser' && (
            <>
              <label>
                URL webového zdroje
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <p className="form-help">
                Web se vykresluje do streamu v odděleném procesu, až 15 snímků/s. Zdroj nepřehrává
                zvuk; pro zvukové alerty použij alerty Zetty.
              </p>
            </>
          )}
          {kind === 'color' && (
            <label>
              Barva
              <input type="color" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          {kind === 'alerts' && (
            <div className="notice-box">
              Tento zdroj zobrazí nové followy, předplatná, dary a další události z připojených
              integrací. Testovací alert je vždy označený jako TEST.
            </div>
          )}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setKind(null)}>
              Zpět
            </button>
            <button
              className="button primary"
              disabled={
                loading ||
                !name ||
                ((kind === 'screen' || kind === 'camera') && !selection) ||
                (['image', 'video'].includes(kind) && !assetPath) ||
                (kind === 'browser' && !value)
              }
              onClick={() => {
                setLoading(true);
                void run(create).finally(() => setLoading(false));
              }}
            >
              <Check size={16} /> Přidat zdroj
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
export function EditSource({
  item,
  onClose,
  onSave,
  onReconnect,
  run,
}: {
  item: SceneSource;
  onClose: () => void;
  onSave: (item: SceneSource) => void;
  onReconnect: (item: SceneSource) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [edit, setEdit] = useState(item);
  const update = (patch: Partial<SceneSource>) => setEdit((s) => ({ ...s, ...patch }));
  return (
    <Modal title="Vlastnosti zdroje" subtitle={item.name} onClose={onClose}>
      <label>
        Název
        <input
          value={edit.name}
          maxLength={100}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      {edit.kind === 'text' && (
        <>
          <label>
            Text
            <textarea
              value={edit.value}
              rows={4}
              onChange={(e) => update({ value: e.target.value })}
            />
          </label>
          <label>
            Velikost písma
            <input
              type="number"
              min={8}
              max={300}
              value={edit.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      {['text', 'color'].includes(edit.kind) && (
        <label>
          Barva
          <input
            type="color"
            value={edit.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
      )}
      {edit.kind === 'browser' && (
        <label>
          URL
          <input value={edit.value} onChange={(e) => update({ value: e.target.value })} />
        </label>
      )}
      {['image', 'video'].includes(edit.kind) && (
        <button
          className="button secondary"
          onClick={() =>
            void run(async () => {
              const asset = await bridge.pickAsset(edit.kind as 'image' | 'video');
              if (asset) update({ value: asset.path });
            })
          }
        >
          <FolderOpen size={15} /> Změnit soubor
        </button>
      )}
      {['screen', 'camera'].includes(edit.kind) && (
        <button
          className="button secondary"
          onClick={() => {
            onReconnect(edit);
            onClose();
          }}
        >
          <AppWindow size={15} /> Znovu připojit{' '}
          {edit.kind === 'screen' ? 'obrazovku / okno' : 'kameru'}
        </button>
      )}
      <div className="form-grid">
        {(['x', 'y', 'width', 'height'] as const).map((key, i) => (
          <label key={key}>
            {['Pozice X', 'Pozice Y', 'Šířka', 'Výška'][i]}
            <input
              type="number"
              value={Math.round(edit[key])}
              min={i > 1 ? 1 : -10000}
              max={8000}
              onChange={(e) => update({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label>
        Průhlednost <span>{Math.round(edit.opacity * 100)} %</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={edit.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </label>
      {!['text', 'color', 'alerts'].includes(edit.kind) && (
        <label>
          Zobrazení
          <select
            value={edit.fit}
            onChange={(e) => update({ fit: e.target.value as 'cover' | 'contain' })}
          >
            <option value="contain">Celý zdroj (zachovat poměr)</option>
            <option value="cover">Vyplnit a oříznout</option>
          </select>
        </label>
      )}
      {edit.kind === 'video' && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={edit.loop}
              onChange={(e) => update({ loop: e.target.checked })}
            />{' '}
            Opakovat video
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!edit.muted}
              onChange={(e) => update({ muted: !e.target.checked })}
            />{' '}
            Zvuk videa
          </label>
          <label>
            Hlasitost videa
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={edit.volume}
              onChange={(e) => update({ volume: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Zrušit
        </button>
        <button
          className="button primary"
          onClick={() => {
            onSave(edit);
            onClose();
          }}
        >
          <Check size={16} /> Uložit změny
        </button>
      </div>
    </Modal>
  );
}
