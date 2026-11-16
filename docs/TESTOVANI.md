# Ověření verze 0.1.1 — Zetty Studio

Ověřeno 16. 11. 2026 na Windows x64.

Přejmenovaná zabalená aplikace `Zetty Studio.exe` prošla všemi pěti desktopovými testy včetně záznamu a skutečného lokálního multistreamu. Ověřen byl název procesu aplikace, titulek okna, Windows metadata produktu `Zetty Studio` / `0.1.1.0` a nová ikona přímo vytažená z EXE. Soubor ICO obsahuje devět velikostí. Instalátor používá název zástupce `Zetty Studio` a `createDesktopShortcut: "always"`; nebyla prováděna instalace do uživatelského systému. Rozhraní bylo vizuálně zkontrolováno při 1500 × 950 a 1100 × 760, bez vodorovného přetékání.

| Kontrola                                                             | Výsledek                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| TypeScript rendereru a desktopové části                              | prošlo                                                |
| Produkční sestavení Vite + Electron                                  | prošlo                                                |
| Jednotkové testy validace RTMP, výstupu, projektu a podpisů webhooků | 5 z 5                                                 |
| Testy desktopového rozhraní ze zdrojové sestavy                      | 5 z 5                                                 |
| Stejné testy zabaleného `Zetty Studio.exe`                           | 5 z 5                                                 |
| Windows NSIS instalátor                                              | vytvořen                                              |
| npm audit při dokončení                                              | 0 známých zranitelností v instalovaných npm balíčcích |

Desktopové testy používají vlastní dočasný profil, syntetickou kameru a mikrofon. Ověřují vytvoření scény a textového zdroje, uložení po restartu stránky, výběr vlastního okna ke snímání, nahrávání WebM, načtení místního obrázku bez znečištění canvasu, vykreslení izolovaného webového zdroje, nastavení a označení testovacích alertů.

Skutečný FFmpeg výstup dorazil současně do **dvou lokálních RTMP přijímačů**. Přijaté soubory šly dekódovat: H.264 1920 × 1080, 30 FPS; AAC 48 kHz stereo, 160 kb/s. Záznam obsahoval složený titulek a syntetickou kameru. Zvuková stopa obsahovala měřitelný signál, nikoli pouze ticho.

Nebylo provedeno veřejné vysílání, přihlášení ke skutečným účtům, provozní ověření Twitch/YouTube/Kick dat ani TikTok partnerské integrace. GPU enkodéry a dlouhodobý výkon vyžadují ověření na konkrétním hardwaru. Nebyl testován podpis vydavatele; vývojový instalátor není podepsaný. Kontrola npm nenahrazuje audit samostatně přibalené binární sestavy FFmpegu.
