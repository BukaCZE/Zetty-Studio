# Připojení platforem

## Twitch

V [Twitch Developer Console](https://dev.twitch.tv/console/apps) vytvoř aplikaci a nastav klienta jako Public. Do Zetty vlož Client ID. Tlačítko Přihlásit otevře oficiální aktivaci zařízení v systémovém prohlížeči a v aplikaci zobrazí kód. Heslo nikdy nezadávej do Zetty.

Požadované scopes: `user:read:chat`, `user:write:chat`, `channel:read:stream_key`, `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`. Některé alerty vyžadují způsobilost kanálu. Připojení používá jeden účet jako broadcaster i chat client. Tokeny se obnovují a validují při spuštění a nejméně jednou za hodinu při aktivním používání.

- [Device code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)
- [Chat client a EventSub](https://dev.twitch.tv/docs/chat/authenticating/)
- [EventSub](https://dev.twitch.tv/docs/eventsub/)

## YouTube

V [Google Cloud Console](https://console.cloud.google.com/) zapni YouTube Data API v3, nastav OAuth consent screen, přidej testovací účet a vytvoř OAuth Client ID typu **Desktop app**. Do aplikace vlož Client ID a Client Secret z desktopového klienta. Desktopový klient je veřejný klient; tento secret neslouží jako důvěryhodné serverové tajemství. Přihlášení používá PKCE a loopback callback na náhodném portu.

Scope: `https://www.googleapis.com/auth/youtube.force-ssl`. Pro distribuci širšímu publiku je potřeba ověření OAuth consent screen podle požadavků Google. V YouTube Studiu připrav přenos, zkopíruj jeho klíč do cíle v aplikaci a zapni cíl. Automatické převzetí klíče je jen doplňková možnost pro aktivní vysílání, pokud jej API poskytne. Aplikace zatím přenosy nevytváří ani nepřepíná jejich lifecycle.

Diváci se čtou z `videos.list(part=liveStreamingDetails)`. Chybějící hodnota je neznámá, nikoli nula. Chat používá `liveChatMessages.list` a čeká alespoň 15 s nebo delší interval požadovaný API. Po vyčerpání kvóty se zobrazí chyba a polling se zpomalí.

- [OAuth pro desktop](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Live Streaming API](https://developers.google.com/youtube/v3/live/getting-started)
- [Chat list a kvóta](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list)
- [Chat streamList pro další rozvoj](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/streamList)

## Kick

V [Kick Developer](https://dev.kick.com/) vytvoř **vlastní osobní** OAuth aplikaci. Redirect URL nastav přesně na `http://127.0.0.1:42817/callback`. Client ID a Secret vyplň v aplikaci. Použit je OAuth 2.1 s PKCE, kontrolou state, timeoutem a loopback listenerem. Scopes: `user:read channel:read chat:write events:subscribe`.

Server a streamovací klíč zkopíruj ze svého Kick dashboardu. Kick nemá pro oficiální události stejný desktopový WebSocket jako Twitch. Proto je v projektu samostatný relay:

```powershell
$env:RELAY_TOKEN = 'vlastni-nahodny-token-alespon-32-znaku'
$env:KICK_BROADCASTER_ID = '123456'
$env:PORT = '8787'
npm run relay
```

Relay poslouchá ve výchozím stavu jen na `127.0.0.1`. Nasaď jej za reverzní HTTPS proxy, která podporuje WebSocket upgrade. Pro kontejner lze nastavit `RELAY_BIND=0.0.0.0`; přístup zvenku povol pouze přes svoji proxy.

- Kick webhook URL: `https://tvuj-relay.example/webhooks/kick`.
- Do Nastavení → Kick: příjem událostí vlož `https://tvuj-relay.example` a tentýž token.
- Aplikace po připojení k relay založí chybějící odběry podporovaných událostí.
- Server je **pro jednoho streamera** s jedním `KICK_BROADCASTER_ID`. Není připravený jako veřejná služba pro více uživatelů.
- Kontroluje podpis přes aktuální veřejný klíč Kick, stáří požadavku, duplicity, velikost těla a broadcaster ID. Token WebSocketu je v hlavičce, nikoli v URL.
- Relay neuchovává historii. Události během odpojení mohou chybět.

Pro veřejnou aplikaci se sdíleným Client ID je nutná další serverová OAuth brána a izolace uživatelů. Veřejný instalační balíček nemůže bezpečně uchovat sdílený Kick Client Secret. Tato verze žádný veřejný secret neobsahuje.

- [Oficiální OAuth dokumentace](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow)
- [Specifikace Kick API](https://api.kick.com/swagger/doc.yaml)
- [Ověřování webhooků](https://docs.kick.com/events/webhook-security)

## TikTok

Tato verze přijímá server a klíč přidělený TikTokem pro externí LIVE vysílání. Nezískává klíče scrapingem a nesnaží se obcházet způsobilost účtu.

V [nabídce veřejných produktů](https://developers.tiktok.com/) není zdokumentovaná obecná integrace poskytující plný LIVE chat, dary a aktuální diváky. Login Kit sám tyto funkce neuděluje. Pro jejich implementaci je potřeba konkrétní schválený partnerský přístup a příslušná specifikace. TikTok účet se zde proto nepředstírá jako přihlášený a LIVE počty se zobrazují jako neznámé.
