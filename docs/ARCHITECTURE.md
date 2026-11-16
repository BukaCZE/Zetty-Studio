# Architektura

```text
Renderer (React + Canvas)
  zdroje → vrstvy scény → Canvas.captureStream → MediaRecorder (WebM)
  mikrofon / systém / video → Web Audio gain → smíchaná zvuková stopa
                           ↓ omezené IPC, sekvenční zápis, backpressure
Electron main → FFmpeg → H.264 + AAC → tee + fifo → RTMP/RTMPS platformy
                      ↘ jedno enkódování, více síťových výstupů
Renderer → samostatný MediaRecorder → main → soubor WebM
```

`src/engine.ts` vlastní mediální zařízení, vrstvový kompozitor a audio graf. Náhled má editační rámečky v DOM mimo obraz canvasu, takže rámečky nevstupují do streamu ani záznamu. Scény a nechráněné nastavení projektu se ukládají v localStorage. Export se validuje pomocí Zod.

`electron/streaming.ts` vlastní životní cyklus FFmpegu. Proces se spouští přes argumentové pole bez shellu. RTMP cíle se validují i proti oddělovačům tee muxeru. Přenos má omezení bloků, čekání na dokončení zápisu, timeout zahájení a pokus o korektní EOF před ukončením procesu. Logy redigují cílové URL a streamovací klíče. Opakované výpadky jednotlivého cíle obsluhuje fifo muxer. Aktivní enkodér není potvrzení doručení všem platformám.

`electron/vault.ts` šifruje celý soubor přihlašovacích údajů přes systémové safeStorage. Selhání šifrování se nikdy nezmění na plaintext fallback. Renderer vidí jen veřejné údaje a příznaky uložených tajemství. Žádný token se neposílá do browser zdrojů.

`electron/auth.ts` zajišťuje device / loopback OAuth flow, PKCE, state, ukončení listeneru, obnovu tokenů a lokální odpojení. `platforms.ts` sjednocuje data platforem a deduplikuje chat a události.

Webové zdroje běží v sandboxovaných offscreen BrowserWindow bez Node a preloadu, s oddělenou dočasnou session, zakázanými oprávněními, stahováním a novými okny. Obraz se přenáší do kompozitoru; zvuk webových zdrojů není součástí první verze. Hlavní okno má CSP, izolovaný preload, sandbox a kontrolu odesílatele IPC.

Místní média jsou dostupná jen pod náhodným ID vlastního protokolu. Obnovení dříve vybraného souboru vyžaduje cestu v registru souborů schválených nativním dialogem. Protokol nepřijímá obecné cesty.

První verze nemá vlastní cloudový účet, analytiku, automatické aktualizace, centrální OAuth bránu nebo backend pro více streamerů. Volitelný Kick relay je jednoúčelový server pro jednoho broadcastera.
