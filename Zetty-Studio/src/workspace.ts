import type { Scene, SceneSource, SourceKind, Workspace } from '../shared/types';
import { workspaceSchema } from '../shared/validation';
export const uid = () => crypto.randomUUID();
export function source(
  kind: SourceKind,
  name: string,
  values: Partial<SceneSource> = {},
): SceneSource {
  return {
    id: uid(),
    name,
    kind,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    value: '',
    color: '#ffffff',
    fontSize: 72,
    volume: 1,
    muted: true,
    loop: true,
    fit: 'contain',
    ...values,
  };
}
export function titleScene(
  name: string,
  heading: string,
  subheading: string,
  background = '#242420',
): Scene {
  return {
    id: uid(),
    name,
    background,
    sources: [
      source('text', 'Značka', {
        x: 100,
        y: 90,
        width: 1400,
        height: 60,
        value: 'ZETTY  /  LIVE STUDIO',
        color: '#f27243',
        fontSize: 30,
      }),
      source('color', 'Barevný akcent', {
        x: 100,
        y: 210,
        width: 180,
        height: 12,
        color: '#f27243',
      }),
      source('text', 'Nadpis', {
        x: 100,
        y: 320,
        width: 1620,
        height: 370,
        value: heading,
        fontSize: 142,
        color: '#f0ece2',
      }),
      source('text', 'Podnadpis', {
        x: 110,
        y: 750,
        width: 1500,
        height: 100,
        value: subheading,
        fontSize: 34,
        color: '#a09d92',
      }),
      source('text', 'Patička', {
        x: 100,
        y: 965,
        width: 1500,
        height: 60,
        value: 'VYSÍLÁNÍ POD TVOJÍ REŽIÍ.                                  Z / 01',
        fontSize: 20,
        color: '#76766c',
      }),
    ],
  };
}
export function defaultWorkspace(): Workspace {
  const scenes = [
    titleScene(
      'Hlavní scéna',
      'TADY BUDE\nTVŮJ STREAM.',
      'Vyber obrazovku, kameru nebo jiný zdroj.',
    ),
    titleScene(
      'Za chvíli začínáme',
      'ZA CHVÍLI\nJSME ŽIVĚ.',
      'Ještě poslední přípravy. Zůstaň na příjmu.',
      '#29251f',
    ),
    titleScene('Pauza', 'MALÁ PAUZA.\nHNED JSEM ZPĚT.', 'Díky, že tu jsi.', '#29272d'),
  ];
  return {
    scenes,
    activeSceneId: scenes[0].id,
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: 6000,
      audioBitrate: 160,
      encoder: 'libx264',
    },
    microphoneId: '',
    microphoneVolume: 0.8,
    microphoneMuted: false,
    desktopVolume: 0.75,
    desktopMuted: false,
    alertSound: true,
    showAlerts: true,
  };
}
const key = 'streamnest-workspace-v1';
export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const workspace = workspaceSchema.parse(JSON.parse(raw));
      // Rebrand the previous built-in mark, preserving the user's scenes and other content.
      for (const scene of workspace.scenes) {
        for (const source of scene.sources) {
          if (source.kind === 'text' && source.value === 'S T R E A M N E S T   /   S T U D I O')
            source.value = 'ZETTY  /  LIVE STUDIO';
          if (source.kind === 'alerts' && source.name === 'Alerty StreamNest')
            source.name = 'Alerty Zetty';
        }
      }
      return workspace;
    }
  } catch {}
  return defaultWorkspace();
}
export const saveWorkspace = (workspace: Workspace) =>
  localStorage.setItem(key, JSON.stringify(workspace));
