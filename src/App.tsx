import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clapperboard,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  Link2,
  ListFilter,
  Lock,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Users,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type {
  AccountView,
  AppSettings,
  ChatMessage,
  Platform,
  Scene,
  SceneSource,
  StreamAlert,
  StreamStatus,
  Workspace,
} from '../shared/types';
import { platformNames } from '../shared/types';
import { workspaceSchema } from '../shared/validation';
import { bridge } from './bridge';
import { defaultWorkspace, loadWorkspace, saveWorkspace, uid } from './workspace';
import { StudioEngine } from './engine';
import { PlatformIcon } from './components/PlatformIcon';
import { Modal } from './components/Modal';
import { Accounts } from './components/Accounts';
import { AddSource, EditSource, sourceIcons } from './components/SourceEditor';
import { Settings, encoderNames } from './components/Settings';
import zettyMark from './assets/zetty-mark.svg';

type Page = 'studio' | 'accounts' | 'activity' | 'settings';
const pageNames: Record<Page, string> = {
  studio: 'Studio',
  accounts: 'Platformy',
  activity: 'Aktivita',
  settings: 'Nastavení',
};
const time = (n: number) =>
  new Date(n).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const format = (n: number) => n.toLocaleString('cs-CZ');
function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [page, setPage] = useState<Page>('studio');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addSource, setAddSource] = useState(false);
  const [editSource, setEditSource] = useState<SceneSource | null>(null);
  const [sceneDialog, setSceneDialog] = useState<{ id?: string; name: string } | null>(null);
  const [deleteScene, setDeleteScene] = useState<Scene | null>(null);
  const [status, setStatus] = useState<StreamStatus>({ state: 'idle' });
  const [recording, setRecording] = useState(false);
  const [recordStarted, setRecordStarted] = useState(0);
  const [working, setWorking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [alerts, setAlerts] = useState<StreamAlert[]>([]);
  const [chatFilter, setChatFilter] = useState<Platform | 'all'>('all');
  const [chatTarget, setChatTarget] = useState<Platform>('twitch');
  const [draft, setDraft] = useState('');
  const [activityFilter, setActivityFilter] = useState<Platform | 'all'>('all');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [guide, setGuide] = useState(false);
  const [authState, setAuthState] = useState<{
    code?: string;
    message: string;
    platform: Platform;
  } | null>(null);
  const [meter, setMeter] = useState({ mic: 0, desktop: 0 });
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const engine = useRef<StudioEngine | null>(null);
  const workspaceRef = useRef(workspace);
  const undo = useRef<Workspace[]>([]);
  const chatEnd = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const lastNotice = useRef('');
  const scene = workspace.scenes.find((s) => s.id === workspace.activeSceneId)!;
  const selectedSource = scene.sources.find((s) => s.id === selected);
  const busy =
    status.state === 'live' || status.state === 'starting' || status.state === 'stopping';
  const accounts = settings?.accounts ?? [];
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), true);
      }
    },
    [notify],
  );
  function commit(value: Workspace | ((w: Workspace) => Workspace)) {
    setWorkspace((current) => {
      undo.current.push(current);
      if (undo.current.length > 30) undo.current.shift();
      return typeof value === 'function' ? value(current) : value;
    });
  }
  function updateScene(fn: (s: Scene) => Scene) {
    commit((w) => ({ ...w, scenes: w.scenes.map((s) => (s.id === w.activeSceneId ? fn(s) : s)) }));
  }
  function updateSource(item: SceneSource) {
    updateScene((s) => ({ ...s, sources: s.sources.map((x) => (x.id === item.id ? item : x)) }));
  }
  function undoChange() {
    const last = undo.current.pop();
    if (last) setWorkspace(last);
  }
  useEffect(() => {
    void run(async () => setSettings(await bridge.bootstrap()));
    const studio = new StudioEngine(
      canvas.current!,
      (text) => notify(text, true),
      (mic, desktop) => setMeter({ mic, desktop }),
    );
    engine.current = studio;
    studio.update(workspaceRef.current);
    const unsubscribe = bridge.onEvent((event) => {
      if (event.type === 'accounts')
        setSettings((s) => (s ? { ...s, accounts: event.data as AccountView[] } : s));
      if (event.type === 'chat') setMessages((m) => [...m, event.data as ChatMessage].slice(-500));
      if (event.type === 'alert') {
        const alert = event.data as StreamAlert;
        setAlerts((a) => [alert, ...a].slice(0, 200));
        studio.showAlert(alert);
      }
      if (event.type === 'stream') {
        const next = event.data as StreamStatus;
        setStatus(next);
        if (next.state === 'error') {
          void studio.stopStream().catch(() => {});
          notify(next.message ?? 'Vysílání selhalo.', true);
        } else if (next.message && next.message !== lastNotice.current) {
          lastNotice.current = next.message;
          notify(next.message, true);
        }
      }
      if (event.type === 'auth') setAuthState(event.data as typeof authState);
      if (event.type === 'notice' && String(event.data) !== lastNotice.current) {
        lastNotice.current = String(event.data);
        notify(String(event.data), true);
      }
    });
    const timer = setInterval(() => {
      setNow(Date.now());
      setRecording((current) => current && studio.isRecording);
    }, 1000);
    return () => {
      studio.dispose();
      unsubscribe();
      clearInterval(timer);
    };
  }, [notify, run]);
  useEffect(() => {
    workspaceRef.current = workspace;
    engine.current?.update(workspace);
    try {
      saveWorkspace(workspace);
    } catch {
      notify('Projekt se nepodařilo uložit. Exportuj si zálohu.', true);
    }
  }, [workspace, notify]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, chatFilter]);
  useEffect(() => {
    const connected = accounts.find((a) => a.connected && a.platform !== 'tiktok');
    if (connected && !accounts.find((a) => a.platform === chatTarget)?.connected)
      setChatTarget(connected.platform);
  }, [accounts, chatTarget]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') ||
        document.querySelector('dialog[open]')
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        undoChange();
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const next = workspaceRef.current.scenes[Number(event.key) - 1];
        if (next) {
          event.preventDefault();
          setWorkspace((w) => ({ ...w, activeSceneId: next.id }));
          setSelected(null);
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  async function microphone(id: string) {
    await engine.current!.setMicrophone(id);
    setMicActive(!!id);
    commit((w) => ({ ...w, microphoneId: id }));
  }
  async function loadMicrophones() {
    const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
    permission.getTracks().forEach((t) => t.stop());
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'audioinput',
    );
    setMicDevices(devices);
    await microphone(
      workspace.microphoneId ||
        devices.find((d) => d.deviceId === 'default')?.deviceId ||
        devices[0]?.deviceId ||
        'default',
    );
  }
  async function add(item: SceneSource, captureId?: string) {
    if (item.kind === 'screen' && captureId) await engine.current!.attachCapture(item, captureId);
    if (item.kind === 'camera')
      await engine.current!.attachCamera(item, item.deviceId ?? 'default');
    updateScene((s) => ({ ...s, sources: [...s.sources, item] }));
    setSelected(item.id);
  }
  async function reconnect(item: SceneSource) {
    if (item.kind === 'camera')
      await engine.current!.attachCamera(item, item.deviceId ?? 'default');
    if (item.kind === 'screen') {
      const sources = await bridge.captures();
      const candidate = sources.find((s) => s.name === item.captureName);
      if (candidate) await engine.current!.attachCapture(item, candidate.id);
      else {
        setAddSource(true);
        notify('Původní okno není dostupné. Vyber nový zdroj.');
      }
    }
  }
  async function toggleStream() {
    setWorking(true);
    await run(async () => {
      if (busy) await engine.current!.stopStream();
      else {
        if (!settings?.desktop) throw new Error('Streamování vyžaduje desktopovou aplikaci.');
        await engine.current!.startStream();
      }
    });
    setWorking(false);
  }
  async function toggleRecord() {
    setWorking(true);
    await run(async () => {
      if (recording) {
        await engine.current!.stopRecording();
        setRecording(false);
        notify('Záznam je uložený.');
      } else {
        const path = await engine.current!.startRecording();
        if (path) {
          setRecording(true);
          setRecordStarted(Date.now());
          notify('Nahrávám do: ' + path);
        }
      }
    });
    setWorking(false);
  }
  function testAlert() {
    const alert: StreamAlert = {
      id: uid(),
      platform: 'twitch',
      user: 'Testovací divák',
      title: 'Nový sledující',
      detail: 'Ukázka upozornění',
      time: Date.now(),
      test: true,
    };
    setAlerts((a) => [alert, ...a].slice(0, 200));
    engine.current!.showAlert(alert);
    notify('Testovací alert. Pro zobrazení v obrazu přidej zdroj Alerty Zetty.');
  }
  function moveLayer(id: string, delta: number) {
    updateScene((s) => {
      const sources = [...s.sources];
      const index = sources.findIndex((x) => x.id === id);
      const target = index + delta;
      if (target >= 0 && target < sources.length)
        [sources[index], sources[target]] = [sources[target], sources[index]];
      return { ...s, sources };
    });
  }
  function dragSource(event: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize') {
    if (!selectedSource || selectedSource.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    const original = selectedSource;
    const bounds = preview.current!.getBoundingClientRect();
    undo.current.push(workspace);
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const onMove = (next: PointerEvent) => {
      const dx = ((next.clientX - start.x) / bounds.width) * workspace.output.width;
      const dy = ((next.clientY - start.y) / bounds.height) * workspace.output.height;
      setWorkspace((w) => ({
        ...w,
        scenes: w.scenes.map((s) =>
          s.id === scene.id
            ? {
                ...s,
                sources: s.sources.map((item) =>
                  item.id === original.id
                    ? {
                        ...item,
                        ...(mode === 'move'
                          ? { x: Math.round(original.x + dx), y: Math.round(original.y + dy) }
                          : {
                              width: Math.max(20, Math.round(original.width + dx)),
                              height: Math.max(20, Math.round(original.height + dy)),
                            }),
                      }
                    : item,
                ),
              }
            : s,
        ),
      }));
    };
    const onEnd = () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onEnd);
      element.removeEventListener('pointercancel', onEnd);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onEnd);
    element.addEventListener('pointercancel', onEnd);
  }
  function exportProject() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Zetty-projekt.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  const knownViewers = accounts.filter((a) => a.viewers !== null && !a.error);
  const total = knownViewers.length
    ? knownViewers.reduce((sum, a) => sum + (a.viewers ?? 0), 0)
    : null;
  const filteredMessages = messages.filter(
    (m) => chatFilter === 'all' || m.platform === chatFilter,
  );
  const filteredAlerts = alerts.filter(
    (a) => activityFilter === 'all' || a.platform === activityFilter,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('studio')} aria-label="Zetty Studio">
          <span className="brand-mark">
            <img src={zettyMark} alt="" />
          </span>
          <span>
            Zetty<span className="brand-sub">STUDIO</span>
          </span>
        </button>
        <div className="workspace-tag">
          <span className="workspace-avatar">01</span>
          <div>
            Moje studio<small>LOKÁLNÍ PROJEKT</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">OVLÁDACÍ PULT</span>
        <nav>
          {(
            [
              { id: 'studio', icon: Clapperboard },
              { id: 'accounts', icon: Link2 },
              { id: 'activity', icon: Bell },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={19} />
              <span>{pageNames[item.id]}</span>
              {item.id === 'activity' && alerts.length > 0 && (
                <span className="nav-count">{alerts.length}</span>
              )}
              {item.id === 'studio' && (
                <span className="nav-shortcut" aria-hidden="true">
                  01
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-label">VÝSTUP / MULTISTREAM</span>
          <b>
            <span>{String(accounts.filter((a) => a.enabled).length).padStart(2, '0')}</span> zapnuté
            cíle
          </b>
          <div className="destination-marks">
            {(['twitch', 'youtube', 'kick', 'tiktok'] as Platform[]).map((platform) => (
              <span
                key={platform}
                className={accounts.find((a) => a.platform === platform)?.enabled ? 'enabled' : ''}
              >
                <PlatformIcon platform={platform} size={18} />
              </span>
            ))}
          </div>
          <button onClick={() => setPage('accounts')}>
            Nastavit výstupy <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => setPage('settings')}
          >
            <Settings2 size={18} />
            <span>Nastavení</span>
          </button>
          <button className="nav-item" onClick={() => setGuide(true)}>
            <CircleHelp size={18} />
            <span>Jak začít</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="local-profile">
            <span className="profile-avatar">
              <img src={zettyMark} alt="" />
            </span>
            <div>
              Lokální studio
              <small>
                <i /> {settings?.desktop ? 'Desktopová aplikace' : 'Náhled rozhraní'}
              </small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>ZETTY STUDIO</span>
            <ChevronRight size={14} />
            <b>{pageNames[page]}</b>
          </div>
          <div className="topbar-right">
            <span className="version-label">v{settings?.version ?? '0.1.1'}</span>
            <span className={`connection-state ${busy ? 'is-live' : ''}`}>
              <i />
              {busy ? 'ON AIR' : 'STANDBY'}
            </span>
            <button
              className="icon-button"
              aria-label="Otevřít nápovědu"
              onClick={() => setGuide(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'studio' ? 'SCÉNY / OBRAZ / ZVUK' : 'ZETTY / STUDIO'}
              </div>
              <h1>{page === 'studio' ? 'Režie' : pageNames[page]}</h1>
              <p>
                {page === 'studio'
                  ? 'Připrav obraz. Srovnej zvuk. Pusť to ven.'
                  : page === 'accounts'
                    ? 'Účty, streamovací klíče a cíle vysílání.'
                    : page === 'activity'
                      ? 'Události z připojených platforem v této relaci.'
                      : 'Kvalita výstupu, enkodér a předvolby studia.'}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className={`button secondary record-button ${recording ? 'recording' : ''}`}
                onClick={() => void toggleRecord()}
                disabled={working}
              >
                <span className="record-dot" />
                {recording ? duration(now - recordStarted) : 'Nahrávat'}
              </button>
              <button
                className={`button primary stream-button ${busy ? 'stop' : ''}`}
                onClick={() => void toggleStream()}
                disabled={working || status.state === 'stopping'}
              >
                {busy ? <Square size={16} fill="currentColor" /> : <Radio size={18} />}{' '}
                {status.state === 'starting'
                  ? 'Zastavit připojování'
                  : busy
                    ? 'Ukončit stream'
                    : 'Spustit stream'}
              </button>
            </div>
          </div>
          <div className={page === 'studio' ? '' : 'hidden'}>
            <div className="stats-row">
              {(['twitch', 'youtube', 'kick', 'tiktok'] as Platform[]).map((p) => {
                const a = accounts.find((x) => x.platform === p);
                return (
                  <button className={`stat-card ${p}`} key={p} onClick={() => setPage('accounts')}>
                    <div className="stat-top">
                      <div className="stat-platform">
                        <PlatformIcon platform={p} size={19} />
                        <span>{platformNames[p]}</span>
                      </div>
                      <span className={`stat-status ${a?.live && !a.error ? 'online' : ''}`}>
                        <i />
                        {a?.error
                          ? 'Chyba API'
                          : a?.live
                            ? 'Živě'
                            : a?.connected
                              ? 'Offline'
                              : p === 'tiktok' && a?.hasStreamKey
                                ? 'RTMP'
                                : 'Nepřipojeno'}
                      </span>
                    </div>
                    <div className="stat-value">
                      <strong>{a?.viewers != null ? format(a.viewers) : '—'}</strong>
                      <span>diváků</span>
                      <Users size={18} />
                    </div>
                    <div className="stat-bottom">
                      <span>
                        {a?.error
                          ? 'Data se nepodařilo načíst'
                          : a?.updatedAt
                            ? `Aktualizováno ${time(a.updatedAt)}`
                            : p === 'tiktok'
                              ? 'LIVE data vyžadují přístup'
                              : 'Propoj účet pro statistiky'}
                      </span>
                      <ArrowUpRight size={13} />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="studio-layout">
              <div className="studio-left">
                <section className="panel preview-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Video size={17} />
                      <h2>Náhled vysílání</h2>
                      <span className="subtle-divider" />
                      <span className="active-scene-name">{scene.name}</span>
                    </div>
                    <div className="preview-actions">
                      <span className={`preview-badge ${busy ? 'live' : ''}`}>
                        <i />
                        {busy ? 'VÝSTUP' : 'NÁHLED'}
                      </span>
                      <button
                        className="icon-button"
                        title="Vrátit změnu (Ctrl+Z)"
                        aria-label="Vrátit změnu"
                        onClick={undoChange}
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="Celá obrazovka"
                        aria-label="Náhled na celou obrazovku"
                        onClick={() => void preview.current?.requestFullscreen()}
                      >
                        <Maximize2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="preview-stage">
                    <div
                      className="canvas-wrap"
                      ref={preview}
                      style={{
                        aspectRatio: `${workspace.output.width}/${workspace.output.height}`,
                      }}
                      onClick={() => setSelected(null)}
                    >
                      <canvas
                        ref={canvas}
                        width={workspace.output.width}
                        height={workspace.output.height}
                      />
                      {selectedSource?.visible && (
                        <div
                          className={`source-bounds ${selectedSource.locked ? 'locked' : ''}`}
                          style={{
                            left: `${(selectedSource.x / workspace.output.width) * 100}%`,
                            top: `${(selectedSource.y / workspace.output.height) * 100}%`,
                            width: `${(selectedSource.width / workspace.output.width) * 100}%`,
                            height: `${(selectedSource.height / workspace.output.height) * 100}%`,
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => dragSource(e, 'move')}
                        >
                          <span className="source-tag">{selectedSource.name}</span>
                          {!selectedSource.locked && (
                            <div
                              className="resize-handle"
                              onPointerDown={(e) => dragSource(e, 'resize')}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="preview-footer">
                    <div>
                      <span>
                        <span className={`tiny-dot ${busy ? 'mint' : ''}`} />
                        {busy ? duration(now - (status.startedAt ?? now)) : 'Offline'}
                      </span>
                      <span>
                        {workspace.output.width} × {workspace.output.height}
                      </span>
                      <span>{workspace.output.fps} FPS</span>
                    </div>
                    <span className="encoder-label">
                      <Cpu size={13} />
                      {encoderNames[workspace.output.encoder]}
                    </span>
                  </div>
                </section>
                <div className="dock-grid">
                  <section className="panel scenes-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Layers size={16} />
                        <h2>Scény</h2>
                        <span className="count-badge">{workspace.scenes.length}</span>
                      </div>
                      <button
                        className="icon-button"
                        title="Přidat scénu"
                        aria-label="Přidat scénu"
                        onClick={() => setSceneDialog({ name: '' })}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    <div className="scenes-list">
                      {workspace.scenes.map((s, index) => (
                        <div
                          key={s.id}
                          className={`scene-row ${scene.id === s.id ? 'selected' : ''}`}
                        >
                          <button
                            className="scene-select"
                            onClick={() => {
                              setWorkspace((w) => ({ ...w, activeSceneId: s.id }));
                              setSelected(null);
                            }}
                          >
                            <span className="scene-thumbnail" style={{ background: s.background }}>
                              <Video size={16} />
                            </span>
                            <span>
                              {s.name}
                              <small>{s.sources.length} zdrojů</small>
                            </span>
                            {scene.id === s.id ? (
                              <span className="scene-active-dot" />
                            ) : (
                              <kbd>{index + 1}</kbd>
                            )}
                          </button>
                          <button
                            className="icon-button scene-edit"
                            aria-label={`Upravit scénu ${s.name}`}
                            onClick={() => setSceneDialog({ id: s.id, name: s.name })}
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="panel-add" onClick={() => setSceneDialog({ name: '' })}>
                      <Plus size={14} /> Nová scéna <kbd>Alt + 1–9</kbd>
                    </button>
                  </section>
                  <section className="panel sources-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Copy size={16} />
                        <h2>Zdroje</h2>
                        <span className="count-badge">{scene.sources.length}</span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Přidat zdroj"
                        onClick={() => setAddSource(true)}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    <div className="sources-list">
                      {[...scene.sources].reverse().map((item) => {
                        const Icon = sourceIcons[item.kind];
                        return (
                          <div
                            key={item.id}
                            className={`source-row ${selected === item.id ? 'selected' : ''} ${!item.visible ? 'source-hidden' : ''}`}
                            onClick={() => setSelected(item.id)}
                            onDoubleClick={() => setEditSource(item)}
                          >
                            <Icon size={15} />
                            <span className="source-name">{item.name}</span>
                            <button
                              className="icon-button"
                              aria-label={`${item.visible ? 'Skrýt' : 'Zobrazit'} zdroj ${item.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSource({ ...item, visible: !item.visible });
                              }}
                            >
                              {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${item.locked ? 'Odemknout' : 'Zamknout'} zdroj ${item.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSource({ ...item, locked: !item.locked });
                              }}
                            >
                              {item.locked ? <Lock size={13} /> : <Unlock size={13} />}
                            </button>
                          </div>
                        );
                      })}
                      {!scene.sources.length && (
                        <div className="small-empty">Scéna čeká na první zdroj.</div>
                      )}
                    </div>
                    <div className="source-toolbar">
                      <button
                        className="icon-button"
                        aria-label="Přidat nový zdroj"
                        onClick={() => setAddSource(true)}
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={!selected}
                        aria-label="Odstranit vybraný zdroj"
                        onClick={() => {
                          updateScene((s) => ({
                            ...s,
                            sources: s.sources.filter((x) => x.id !== selected),
                          }));
                          setSelected(null);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                      <span />
                      <button
                        className="icon-button"
                        disabled={!selected}
                        aria-label="Posunout zdroj výš"
                        onClick={() => selected && moveLayer(selected, 1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={!selected}
                        aria-label="Posunout zdroj níž"
                        onClick={() => selected && moveLayer(selected, -1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={!selectedSource}
                        aria-label="Vlastnosti vybraného zdroje"
                        onClick={() => selectedSource && setEditSource(selectedSource)}
                      >
                        <Settings2 size={15} />
                      </button>
                    </div>
                  </section>
                  <section className="panel audio-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Volume2 size={16} />
                        <h2>Zvukový mixér</h2>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Nastavení zvuku"
                        onClick={() => setPage('settings')}
                      >
                        <Settings2 size={16} />
                      </button>
                    </div>
                    <div className="audio-content">
                      <div className="mixer-channel">
                        <div className="channel-header">
                          <span>
                            <Mic size={14} /> Mikrofon
                          </span>
                          <small>
                            {micActive
                              ? `${Math.round(workspace.microphoneVolume * 100)} %`
                              : 'Nepřipojen'}
                          </small>
                        </div>
                        <div className="level-meter">
                          <div
                            style={{
                              width: `${micActive && !workspace.microphoneMuted ? meter.mic * 100 : 0}%`,
                            }}
                          />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="volume-row">
                          <button
                            className={`icon-button ${workspace.microphoneMuted ? 'muted-red' : ''}`}
                            aria-label="Ztlumit mikrofon"
                            onClick={() =>
                              commit((w) => ({ ...w, microphoneMuted: !w.microphoneMuted }))
                            }
                          >
                            {workspace.microphoneMuted ? <MicOff size={15} /> : <Mic size={15} />}
                          </button>
                          <input
                            aria-label="Hlasitost mikrofonu"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={workspace.microphoneVolume}
                            onChange={(e) =>
                              setWorkspace((w) => ({
                                ...w,
                                microphoneVolume: Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                        {micActive ? (
                          <select
                            className="device-select"
                            aria-label="Mikrofon"
                            value={workspace.microphoneId}
                            onChange={(e) => void run(() => microphone(e.target.value))}
                          >
                            <option value="">Odpojit mikrofon</option>
                            {micDevices.map((d, i) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                {d.label || `Mikrofon ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button className="connect-mic" onClick={() => void run(loadMicrophones)}>
                            <Plus size={12} /> Připojit mikrofon
                          </button>
                        )}
                      </div>
                      <div className="mixer-channel">
                        <div className="channel-header">
                          <span>
                            <Volume2 size={14} /> Zvuk počítače
                          </span>
                          <small>{Math.round(workspace.desktopVolume * 100)} %</small>
                        </div>
                        <div className="level-meter">
                          <div
                            style={{
                              width: `${workspace.desktopMuted ? 0 : meter.desktop * 100}%`,
                            }}
                          />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="volume-row">
                          <button
                            className={`icon-button ${workspace.desktopMuted ? 'muted-red' : ''}`}
                            aria-label="Ztlumit systémový zvuk"
                            onClick={() => commit((w) => ({ ...w, desktopMuted: !w.desktopMuted }))}
                          >
                            {workspace.desktopMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                          </button>
                          <input
                            aria-label="Hlasitost systému"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={workspace.desktopVolume}
                            onChange={(e) =>
                              setWorkspace((w) => ({ ...w, desktopVolume: Number(e.target.value) }))
                            }
                          />
                        </div>
                        <p className="channel-note">Aktivní při sdílení obrazovky</p>
                      </div>
                    </div>
                  </section>
                </div>
                <div className="studio-tip">
                  <span>
                    <Plus size={17} />
                  </span>
                  <div>
                    <b>Postav si scénu.</b>
                    <p>Obrazovka, kamera, média nebo webový overlay.</p>
                  </div>
                  <button className="button secondary" onClick={() => setAddSource(true)}>
                    <Plus size={14} /> Přidat zdroj
                  </button>
                </div>
              </div>
              <div className="studio-right">
                <section className="panel chat-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <MessageCircle size={17} />
                      <h2>Společný chat</h2>
                    </div>
                    <span className="count-badge">{messages.length}</span>
                  </div>
                  <div className="chat-tabs">
                    <button
                      className={chatFilter === 'all' ? 'active' : ''}
                      onClick={() => setChatFilter('all')}
                    >
                      Vše
                    </button>
                    {(['twitch', 'youtube', 'kick', 'tiktok'] as Platform[]).map((p) => (
                      <button
                        key={p}
                        className={chatFilter === p ? 'active' : ''}
                        title={platformNames[p]}
                        aria-label={`Chat ${platformNames[p]}`}
                        onClick={() => setChatFilter(p)}
                      >
                        <PlatformIcon platform={p} size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="chat-messages">
                    {!filteredMessages.length ? (
                      <div className="chat-empty">
                        <div className="chat-empty-art">
                          <MessageCircle size={34} strokeWidth={1.3} />
                          <span className="bubble-dot a" />
                          <span className="bubble-dot b" />
                          <span className="bubble-dot c" />
                        </div>
                        <h3>Čekáme na chat.</h3>
                        <p>
                          Připoj účet a sleduj zprávy
                          <br />
                          ze všech svých kanálů.
                        </p>
                        <button className="text-button" onClick={() => setPage('accounts')}>
                          Propojit účty <ArrowUpRight size={14} />
                        </button>
                      </div>
                    ) : (
                      filteredMessages.map((m) => (
                        <div className="chat-message" key={`${m.platform}-${m.id}`}>
                          <PlatformIcon platform={m.platform} size={15} />
                          <div>
                            <span
                              className="chat-author"
                              style={{
                                color: /^#[0-9a-f]{6}$/i.test(m.color ?? '') ? m.color : undefined,
                              }}
                            >
                              {m.user}
                            </span>
                            <time>{time(m.time)}</time>
                            <p>{m.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={chatEnd} />
                  </div>
                  <form
                    className="chat-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = draft;
                      if (!text.trim()) return;
                      void run(async () => {
                        await bridge.sendChat(chatTarget, text);
                        setDraft('');
                      });
                    }}
                  >
                    <div>
                      <PlatformIcon platform={chatTarget} size={14} />
                      <select
                        value={chatTarget}
                        aria-label="Odeslat zprávu na platformu"
                        onChange={(e) => setChatTarget(e.target.value as Platform)}
                      >
                        {(['twitch', 'youtube', 'kick'] as Platform[]).map((p) => (
                          <option key={p} value={p}>
                            {platformNames[p]}
                          </option>
                        ))}
                      </select>
                      <span>
                        {accounts.find((a) => a.platform === chatTarget)?.connected
                          ? 'Připojeno'
                          : 'Účet není připojený'}
                      </span>
                    </div>
                    <div className="chat-input">
                      <input
                        value={draft}
                        maxLength={500}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Napiš své komunitě…"
                        aria-label="Zpráva do chatu"
                      />
                      <button
                        type="submit"
                        aria-label="Odeslat zprávu"
                        disabled={
                          !draft.trim() ||
                          !accounts.find((a) => a.platform === chatTarget)?.connected
                        }
                      >
                        <Send size={17} />
                      </button>
                    </div>
                  </form>
                </section>
                <section className="panel alerts-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Bell size={16} />
                      <h2>Poslední alerty</h2>
                    </div>
                    <button
                      className="icon-button"
                      title="Testovací alert"
                      aria-label="Spustit testovací alert"
                      onClick={testAlert}
                    >
                      <Zap size={16} />
                    </button>
                  </div>
                  <div className="alerts-feed">
                    {!alerts.length ? (
                      <div className="alerts-empty">
                        <span>
                          <BellRing size={22} strokeWidth={1.4} />
                        </span>
                        <b>Zatím žádné alerty.</b>
                        <p>
                          Události z připojených kanálů
                          <br />
                          se zobrazí tady.
                        </p>
                        <button className="text-button" onClick={testAlert}>
                          Vyzkoušet alert <Play size={12} />
                        </button>
                      </div>
                    ) : (
                      alerts.slice(0, 4).map((a) => <AlertRow key={a.id} alert={a} />)
                    )}
                  </div>
                  {alerts.length > 0 && (
                    <button className="panel-add" onClick={() => setPage('activity')}>
                      Zobrazit vše <ArrowUpRight size={13} />
                    </button>
                  )}
                </section>
              </div>
            </div>
            <footer className="studio-status">
              <div>
                <Wifi size={14} />
                <span>{busy ? 'Enkodér aktivní' : 'Výstup zastavený'}</span>
                <i />
                <span>{accounts.filter((a) => a.enabled).length} cíle vysílání</span>
              </div>
              <div>
                <Users size={13} />
                {total === null
                  ? 'Počty diváků čekají na připojení'
                  : `${format(total)} diváků celkem`}
                <span>Obnova dat každých 15 s</span>
              </div>
            </footer>
          </div>
          {page === 'accounts' && settings && (
            <Accounts settings={settings} onSaved={setSettings} run={run} streaming={busy} />
          )}
          {page === 'settings' && settings && (
            <Settings
              workspace={workspace}
              onChange={(w) => {
                commit(workspaceSchema.parse(w));
                notify('Nastavení uloženo.');
              }}
              settings={settings}
              onSettings={setSettings}
              run={run}
              busy={busy || recording}
              onExport={exportProject}
              onImport={() => importInput.current?.click()}
            />
          )}
          {page === 'activity' && (
            <section className="panel activity-page">
              <div className="panel-header">
                <div className="panel-title">
                  <BellRing size={18} />
                  <h2>Události v této relaci</h2>
                  <span className="count-badge">{alerts.length}</span>
                </div>
                <div className="activity-controls">
                  <select
                    aria-label="Filtrovat alerty"
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value as Platform | 'all')}
                  >
                    <option value="all">Všechny platformy</option>
                    {Object.entries(platformNames).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button className="button secondary" onClick={testAlert}>
                    <Zap size={14} /> Test alertu
                  </button>
                </div>
              </div>
              {!filteredAlerts.length ? (
                <div className="activity-empty">
                  <BellRing size={42} strokeWidth={1} />
                  <h3>Na první moment se nezapomíná.</h3>
                  <p>Připoj platformy a sleduj události z celé své komunity.</p>
                  <button className="button primary" onClick={() => setPage('accounts')}>
                    <Link2 size={15} /> Připojit platformy
                  </button>
                </div>
              ) : (
                <div className="activity-list">
                  {filteredAlerts.map((a) => (
                    <AlertRow key={a.id} alert={a} />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
      <input
        type="file"
        accept="application/json,.json"
        ref={importInput}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void run(async () => {
              if (file.size > 5 * 1024 * 1024) throw new Error('Projekt je příliš velký.');
              const next = workspaceSchema.parse(JSON.parse(await file.text()));
              commit(next);
              setSelected(null);
              notify('Projekt byl načtený. Obrazovku, kameru a mikrofon znovu připoj.');
            });
          e.target.value = '';
        }}
      />
      {addSource && (
        <AddSource
          onClose={() => setAddSource(false)}
          onAdd={add}
          run={run}
          width={workspace.output.width}
          height={workspace.output.height}
        />
      )}
      {editSource && (
        <EditSource
          item={editSource}
          onClose={() => setEditSource(null)}
          onSave={(item) => {
            const result = workspaceSchema.safeParse({
              ...workspace,
              scenes: workspace.scenes.map((s) =>
                s.id === scene.id
                  ? { ...s, sources: s.sources.map((x) => (x.id === item.id ? item : x)) }
                  : s,
              ),
            });
            if (result.success) updateSource(item);
            else notify('Neplatné rozměry nebo hodnoty zdroje.', true);
          }}
          onReconnect={(item) => void run(() => reconnect(item))}
          run={run}
        />
      )}
      {sceneDialog && (
        <Modal
          title={sceneDialog.id ? 'Upravit scénu' : 'Nová scéna'}
          subtitle="Scény přepneš jedním kliknutím nebo pomocí Alt + 1–9."
          onClose={() => setSceneDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!sceneDialog.name.trim()) return;
              if (sceneDialog.id)
                commit((w) => ({
                  ...w,
                  scenes: w.scenes.map((s) =>
                    s.id === sceneDialog.id ? { ...s, name: sceneDialog.name.trim() } : s,
                  ),
                }));
              else {
                const next: Scene = {
                  id: uid(),
                  name: sceneDialog.name.trim(),
                  sources: [],
                  background: '#14242c',
                };
                commit((w) => ({ ...w, scenes: [...w.scenes, next], activeSceneId: next.id }));
                setSelected(null);
              }
              setSceneDialog(null);
            }}
          >
            <label>
              Název scény
              <input
                autoFocus
                maxLength={100}
                value={sceneDialog.name}
                onChange={(e) => setSceneDialog({ ...sceneDialog, name: e.target.value })}
                placeholder="Například: Hraní"
              />
            </label>
            {sceneDialog.id && (
              <>
                <label>
                  Pozadí scény
                  <input
                    type="color"
                    value={
                      workspace.scenes.find((s) => s.id === sceneDialog.id)?.background ?? '#14242c'
                    }
                    onChange={(e) =>
                      commit((w) => ({
                        ...w,
                        scenes: w.scenes.map((s) =>
                          s.id === sceneDialog.id ? { ...s, background: e.target.value } : s,
                        ),
                      }))
                    }
                  />
                </label>
                <div className="scene-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const original = workspace.scenes.find((s) => s.id === sceneDialog.id)!;
                      const duplicate = {
                        ...original,
                        id: uid(),
                        name: original.name + ' – kopie',
                        sources: original.sources.map((s) => ({ ...s, id: uid() })),
                      };
                      commit((w) => ({ ...w, scenes: [...w.scenes, duplicate] }));
                      setSceneDialog(null);
                    }}
                  >
                    <Copy size={14} /> Duplikovat
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={workspace.scenes.length < 2}
                    onClick={() => {
                      setDeleteScene(workspace.scenes.find((s) => s.id === sceneDialog.id)!);
                      setSceneDialog(null);
                    }}
                  >
                    <Trash2 size={14} /> Odstranit
                  </button>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setSceneDialog(null)}
              >
                Zrušit
              </button>
              <button className="button primary" disabled={!sceneDialog.name.trim()}>
                <Check size={15} /> Uložit scénu
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleteScene && (
        <Modal
          title="Odstranit scénu?"
          subtitle={`Scéna „${deleteScene.name}“ bude odstraněna včetně zdrojů.`}
          onClose={() => setDeleteScene(null)}
        >
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleteScene(null)}>
              Zrušit
            </button>
            <button
              className="button danger"
              onClick={() => {
                commit((w) => {
                  const scenes = w.scenes.filter((s) => s.id !== deleteScene.id);
                  return {
                    ...w,
                    scenes,
                    activeSceneId:
                      w.activeSceneId === deleteScene.id ? scenes[0].id : w.activeSceneId,
                  };
                });
                setDeleteScene(null);
              }}
            >
              Odstranit scénu
            </button>
          </div>
        </Modal>
      )}
      {guide && (
        <Modal
          title="Z nuly do vysílání."
          subtitle="Pět kroků k tvému prvnímu streamu."
          onClose={() => setGuide(false)}
        >
          <div className="guide-steps">
            {[
              [
                'Připrav si scénu',
                'Přidej obrazovku nebo okno, kameru a další zdroje. Pořadí určuje jejich vrstvení.',
              ],
              [
                'Připoj zvuk',
                'V mixéru připoj mikrofon. Zvuk počítače se snímá se sdílením obrazovky. Vybírej jen jeden zdroj systémového zvuku.',
              ],
              [
                'Nastav platformy',
                'Vyplň server a klíč ze studia každé platformy. Přihlášení přes OAuth zapne dostupný chat a statistiky.',
              ],
              [
                'Vyber kvalitu',
                'V Nastavení zvol rozlišení, FPS a CPU nebo GPU enkodér. Pro každý cíl potřebuješ odpovídající upload.',
              ],
              [
                'Jsi na řadě',
                'Zapni cíle multistreamu a spusť stream. Doručení ověř ve studiích platforem. YouTube přenos připrav předem.',
              ],
            ].map(([title, text], i) => (
              <div key={title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="notice-box">
            Tato první verze je samostatné studio bez OBS. Příjem Kick chatu vyžaduje relay server.
            TikTok LIVE data vyžadují přístup od TikToku. Pro první test použij soukromý přenos.
          </p>
          <div className="modal-actions">
            <button className="button primary" onClick={() => setGuide(false)}>
              Jdeme na to <ArrowUpRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {authState && (
        <div className="auth-banner">
          <PlatformIcon platform={authState.platform} size={20} />
          <div>
            <b>{authState.message}</b>
            {authState.code && (
              <span>
                Kód: <strong>{authState.code}</strong>
              </span>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Zrušit přihlašování"
            onClick={() => void run(() => bridge.disconnect(authState.platform))}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.error ? <CircleHelp size={19} /> : <CheckCheck size={19} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Zavřít oznámení"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function AlertRow({ alert }: { alert: StreamAlert }) {
  return (
    <div className="alert-row">
      <span className={`alert-platform ${alert.platform}`}>
        <PlatformIcon platform={alert.platform} size={18} />
      </span>
      <div>
        <b>
          {alert.user}
          {alert.test && <span className="test-badge">TEST</span>}
        </b>
        <p>
          {alert.title}
          {alert.detail ? ' · ' + alert.detail : ''}
        </p>
      </div>
      <time>{time(alert.time)}</time>
    </div>
  );
}
