import { useState } from 'react';
import { ArrowUpRight, Check, Link2, LockKeyhole, Radio, Save, Unplug } from 'lucide-react';
import {
  type AccountView,
  type AppSettings,
  type Platform,
  platformNames,
} from '../../shared/types';
import { bridge } from '../bridge';
import { PlatformIcon } from './PlatformIcon';
import { Modal } from './Modal';

const dashboards: Record<Platform, string> = {
  twitch: 'https://dashboard.twitch.tv/settings/stream',
  youtube: 'https://studio.youtube.com',
  kick: 'https://dashboard.kick.com',
  tiktok: 'https://www.tiktok.com/studio',
};
export function AccountEditor({
  account,
  onClose,
  onSaved,
  run,
}: {
  account: AccountView;
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [clientId, setClientId] = useState(account.clientId);
  const [secret, setSecret] = useState('');
  const [server, setServer] = useState(account.serverUrl);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={`Nastavit ${platformNames[account.platform]}`}
      subtitle="Propojení účtu a cíl vysílání jsou samostatná nastavení."
      onClose={onClose}
    >
      <div className="form-section-title">
        <Link2 size={16} /> Přihlášení k účtu
      </div>
      {account.platform === 'tiktok' ? (
        <div className="notice-box">
          TikTok neposkytuje ve veřejném developer API LIVE chat, alerty ani diváky. Vysílání
          funguje přes RTMP, pokud ti TikTok přidělil server a klíč. Přihlášení přes Login Kit tyto
          funkce neodemkne.
        </div>
      ) : (
        <>
          <p className="form-help">
            {account.platform === 'twitch'
              ? 'Použij Client ID registrované Twitch aplikace typu Public. Přihlášení proběhne v systémovém prohlížeči.'
              : account.platform === 'youtube'
                ? 'V Google Cloud zapni YouTube Data API v3 a vytvoř OAuth klienta typu Desktop app. Pro veřejné vydání je potřeba ověřená OAuth aplikace.'
                : 'Pro vývoj použij vlastní Kick OAuth aplikaci. Callback: http://127.0.0.1:42817/callback. Pro veřejnou distribuci je potřeba serverové OAuth řešení.'}
          </p>
          <label>
            OAuth Client ID
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              placeholder="Client ID od platformy"
              disabled={account.connected}
            />
          </label>
          {account.platform !== 'twitch' && (
            <label>
              Client Secret {account.hasClientSecret && <span className="field-hint">uložený</span>}
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                placeholder={
                  account.hasClientSecret
                    ? 'Ponech prázdné pro zachování'
                    : account.platform === 'kick'
                      ? 'Povinné pro vlastní Kick aplikaci'
                      : 'Secret z desktopového OAuth klienta'
                }
              />
            </label>
          )}
        </>
      )}
      <div className="form-section-title">
        <Radio size={16} /> Kam vysílat
      </div>
      <label>
        Adresa RTMP / RTMPS serveru
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="rtmps://server.example/live"
          spellCheck={false}
        />
      </label>
      <label>
        Streamovací klíč {account.hasStreamKey && <span className="field-hint">uložený</span>}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="new-password"
          placeholder={
            account.hasStreamKey ? 'Ponech prázdné pro zachování' : 'Vlož klíč ze studia platformy'
          }
        />
      </label>
      <button
        className="text-button"
        onClick={() => void run(() => bridge.openExternal(dashboards[account.platform]))}
      >
        Otevřít studio {platformNames[account.platform]} <ArrowUpRight size={14} />
      </button>
      <p className="secure-note">
        <LockKeyhole size={14} /> Klíče se ukládají šifrovaně v profilu Windows.
      </p>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Zrušit
        </button>
        <button
          className="button primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void run(async () => {
              const result = await bridge.saveAccount({
                platform: account.platform,
                clientId,
                clientSecret: secret || undefined,
                serverUrl: server,
                streamKey: key || undefined,
              });
              onSaved(result);
              onClose();
            }).finally(() => setSaving(false));
          }}
        >
          <Save size={16} />
          {saving ? 'Ukládám…' : 'Uložit nastavení'}
        </button>
      </div>
    </Modal>
  );
}
export function Accounts({
  settings,
  onSaved,
  run,
  streaming,
}: {
  settings: AppSettings;
  onSaved: (s: AppSettings) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  streaming: boolean;
}) {
  const [edit, setEdit] = useState<AccountView | null>(null);
  const [pending, setPending] = useState<Platform | null>(null);
  return (
    <>
      <div className="section-intro">
        <span className="eyebrow">ÚČTY / STREAMOVACÍ KLÍČE</span>
        <h2>Připojení a výstupy</h2>
        <p>
          Připoj účty pro chat a statistiky. Pro vysílání nastav cílový server, klíč a zapni
          přepínač.
        </p>
      </div>
      <div className="accounts-grid">
        {settings.accounts.map((account) => (
          <article className={`account-card ${account.platform}`} key={account.platform}>
            <div className="account-card-top">
              <div className="platform-box">
                <PlatformIcon platform={account.platform} size={28} />
              </div>
              <span className={`status-pill ${account.connected ? 'connected' : ''}`}>
                {account.connected ? (
                  <>
                    <Check size={12} /> Připojeno
                  </>
                ) : account.platform === 'tiktok' ? (
                  'RTMP připojení'
                ) : (
                  'Nepřipojeno'
                )}
              </span>
            </div>
            <h3>{platformNames[account.platform]}</h3>
            <p className="account-name">{account.name || 'Připrav svou další zastávku.'}</p>
            <div className="account-features">
              <span>
                <Check size={14} /> Vysílání přes RTMP
              </span>
              <span className={account.platform === 'tiktok' ? 'muted' : ''}>
                <Check size={14} />
                {account.platform === 'kick'
                  ? 'Chat a alerty přes relay'
                  : account.platform === 'tiktok'
                    ? 'LIVE data vyžadují partnera'
                    : 'Chat, alerty a diváci'}
              </span>
            </div>
            <div className="target-toggle">
              <div>
                <b>Cíl multistreamu</b>
                <small>
                  {account.hasStreamKey
                    ? 'Streamovací klíč je uložený'
                    : 'Nejdřív nastav streamovací klíč'}
                </small>
              </div>
              <button
                className={`switch ${account.enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={account.enabled}
                aria-label={`Vysílat na ${platformNames[account.platform]}`}
                disabled={streaming || !account.hasStreamKey || !account.serverUrl}
                onClick={() =>
                  void run(async () =>
                    onSaved(
                      await bridge.saveAccount({
                        platform: account.platform,
                        enabled: !account.enabled,
                      }),
                    ),
                  )
                }
              >
                <span />
              </button>
            </div>
            <div className="account-actions">
              <button
                className="button secondary"
                disabled={streaming}
                onClick={() => setEdit(account)}
              >
                Nastavení
              </button>
              {account.platform !== 'tiktok' && (
                <button
                  className={`button ${account.connected ? 'secondary' : 'primary'}`}
                  disabled={pending === account.platform}
                  onClick={() => {
                    setPending(account.platform);
                    void run(async () => {
                      if (account.connected) await bridge.disconnect(account.platform);
                      else await bridge.connect(account.platform);
                      onSaved(await bridge.bootstrap());
                    }).finally(() => setPending(null));
                  }}
                >
                  {account.connected ? <Unplug size={15} /> : <Link2 size={15} />}{' '}
                  {pending === account.platform
                    ? 'Čekám…'
                    : account.connected
                      ? 'Odpojit'
                      : 'Přihlásit'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="info-strip">
        <LockKeyhole size={20} />
        <div>
          <b>Tvoje účty zůstávají tvoje.</b>
          <p>Přihlášení probíhá u poskytovatele. Hesla k platformám aplikace nepožaduje.</p>
        </div>
      </div>
      {edit && (
        <AccountEditor account={edit} onClose={() => setEdit(null)} onSaved={onSaved} run={run} />
      )}
    </>
  );
}
