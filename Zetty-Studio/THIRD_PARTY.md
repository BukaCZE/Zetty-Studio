# Komponenty třetích stran

Zdrojový kód Zetty Studio je MIT. Závislosti a přibalené programy mají vlastní licence.

- React / React DOM: MIT, https://github.com/facebook/react
- Electron: MIT a komponenty Chromium s vlastními licencemi, https://github.com/electron/electron
- Lucide: ISC, https://github.com/lucide-icons/lucide
- Inter: SIL Open Font License 1.1, https://github.com/rsms/inter
- Barlow Condensed: SIL Open Font License 1.1, https://github.com/jpt/barlow
- IBM Plex Mono: SIL Open Font License 1.1, https://github.com/IBM/plex
- Zod: MIT, https://github.com/colinhacks/zod
- ws: MIT, https://github.com/websockets/ws
- ffmpeg-static: GPL-3.0-or-later, https://github.com/eugeneware/ffmpeg-static

## FFmpeg

FFmpeg se spouští jako samostatný proces. Binární soubor pochází z releasu `b6.1.1` projektu ffmpeg-static (verzi a konfiguraci ověř příkazem `ffmpeg.exe -version`). Součástí instalačního balíčku musí zůstat `ffmpeg.exe.LICENSE`, `ffmpeg.exe.README` a licence balíčku v `node_modules/ffmpeg-static`. Electron builder celý tento adresář rozbalí vedle app.asar.

- Dodavatel binárních souborů a archiv releasu: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- Zdrojový kód FFmpeg: https://ffmpeg.org/download.html#get-sources
- Licenční informace FFmpeg: https://ffmpeg.org/legal.html

Před veřejnou distribucí zajisti zpřístupnění přesného odpovídajícího zdrojového kódu přibalené sestavy včetně použitých závislostí a konfiguračních voleb podle její licence. Samotný odkaz na aktuální upstream nezaručuje splnění těchto podmínek. Lokální vývojový instalátor není prohlášením o dokončeném distribučním auditu.

Loga Twitch, YouTube, Kick a TikTok se používají k označení příslušné platformy. Značky patří jejich vlastníkům; aplikace není jejich oficiálním produktem.
