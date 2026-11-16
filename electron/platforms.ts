import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { type BridgeEvent, type Platform } from '../shared/types.js';
import { Auth } from './auth.js';
import { Vault } from './vault.js';

export class Platforms {
  private timer?: ReturnType<typeof setInterval>;
  private chatTimer?: ReturnType<typeof setTimeout>;
  private twitch?: WebSocket;
  private twitchRetry?: ReturnType<typeof setTimeout>;
  private twitchWatchdog?: ReturnType<typeof setTimeout>;
  private relay?: WebSocket;
  private relayRetry?: ReturnType<typeof setTimeout>;
  private relayIdentity = '';
  private youtubeChatId = '';
  private youtubePage = '';
  private seen = new Set<string>();
  private busy = false;
  private disposed = false;
  private chatGeneration = 0;
  constructor(
    private vault: Vault,
    private auth: Auth,
    private emit: (event: BridgeEvent) => void,
  ) {}
  start() {
    this.timer = setInterval(() => void this.refresh(), 15000);
    void this.refresh();
  }
  async refresh() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      await Promise.allSettled(
        (['twitch', 'youtube', 'kick'] as Platform[]).map(async (platform) => {
          const a = this.vault.data.accounts[platform];
          if (!a.accessToken) return;
          try {
            let viewers: number | null = null;
            let live = false;
            if (platform === 'twitch') {
              await this.auth.validateTwitch();
              const streams = await this.auth.request(platform, `/streams?user_id=${a.userId}`);
              live = !!streams.data.length;
              viewers = live ? streams.data[0].viewer_count : 0;
              if (!this.twitch && !this.twitchRetry) this.startTwitch();
            } else if (platform === 'youtube') {
              const broadcasts = await this.auth.request(
                platform,
                '/liveBroadcasts?part=id,snippet,contentDetails&broadcastStatus=active&broadcastType=all&maxResults=1',
              );
              const broadcast = broadcasts.items?.[0];
              live = !!broadcast;
              const chatId = broadcast?.snippet?.liveChatId ?? '';
              if (chatId !== this.youtubeChatId) {
                this.youtubeChatId = chatId;
                this.youtubePage = '';
                clearTimeout(this.chatTimer);
                const generation = ++this.chatGeneration;
                if (chatId) void this.pollYoutube(generation);
              }
              if (broadcast) {
                const video = await this.auth.request(
                  platform,
                  `/videos?part=liveStreamingDetails&id=${broadcast.id}`,
                );
                const value = video.items?.[0]?.liveStreamingDetails?.concurrentViewers;
                viewers = value === undefined ? null : Number(value);
                const streamId = broadcast.contentDetails?.boundStreamId;
                if (streamId && !a.streamKey) {
                  const stream = await this.auth.request(
                    platform,
                    `/liveStreams?part=cdn&id=${streamId}`,
                  );
                  const ingestion = stream.items?.[0]?.cdn?.ingestionInfo;
                  if (ingestion?.streamName) {
                    a.streamKey = ingestion.streamName;
                    a.serverUrl = ingestion.rtmpsIngestionAddress ?? ingestion.ingestionAddress;
                    this.vault.save();
                  }
                }
              } else viewers = 0;
            } else {
              // Channels is the current public API and includes the channel's live state.
              const channels = await this.auth.request(
                platform,
                `/channels?broadcaster_user_id=${a.userId}`,
              );
              const stream = channels.data?.[0]?.stream;
              live = !!stream?.is_live;
              viewers = live ? (stream?.viewer_count ?? null) : 0;
            }
            this.vault.stats[platform] = { viewers, live, updatedAt: Date.now() };
          } catch (error) {
            this.vault.stats[platform] = {
              viewers: null,
              live: false,
              updatedAt: this.vault.stats[platform]?.updatedAt ?? null,
              error: String(error).slice(0, 250),
            };
          }
        }),
      );
      this.syncRelay();
      this.emit({ type: 'accounts', data: this.vault.view().accounts });
    } finally {
      this.busy = false;
    }
  }
  private fresh(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 3000) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  private startTwitch(url = 'wss://eventsub.wss.twitch.tv/ws', replacing = false) {
    if (this.disposed || !this.vault.data.accounts.twitch.accessToken) return;
    const socket = new WebSocket(url);
    const old = this.twitch;
    this.twitch = socket;
    if (!replacing) old?.close();
    const watchdog = (seconds = 20) => {
      clearTimeout(this.twitchWatchdog);
      this.twitchWatchdog = setTimeout(() => socket.terminate(), seconds * 1000 + 5000);
    };
    socket.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      watchdog(msg.payload?.session?.keepalive_timeout_seconds ?? 20);
      const type = msg.metadata?.message_type;
      if (type === 'session_welcome') {
        if (replacing) {
          old?.close();
          return;
        }
        const sessionId = msg.payload.session.id;
        const user = this.vault.data.accounts.twitch.userId;
        const subscriptions = [
          {
            type: 'channel.chat.message',
            version: '1',
            condition: { broadcaster_user_id: user, user_id: user },
          },
          {
            type: 'channel.follow',
            version: '2',
            condition: { broadcaster_user_id: user, moderator_user_id: user },
          },
          { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: user } },
          {
            type: 'channel.subscription.gift',
            version: '1',
            condition: { broadcaster_user_id: user },
          },
          {
            type: 'channel.subscription.message',
            version: '1',
            condition: { broadcaster_user_id: user },
          },
          { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: user } },
          { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: user } },
        ];
        void (async () => {
          for (const subscription of subscriptions) {
            if (this.twitch !== socket || !this.vault.data.accounts.twitch.accessToken) break;
            try {
              await this.auth.request('twitch', '/eventsub/subscriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...subscription,
                  transport: { method: 'websocket', session_id: sessionId },
                }),
              });
            } catch (e) {
              this.emit({ type: 'notice', data: `Twitch ${subscription.type}: ${String(e)}` });
            }
          }
        })();
      } else if (type === 'session_reconnect') {
        const next = msg.payload.session.reconnect_url;
        if (typeof next === 'string' && new URL(next).hostname === 'eventsub.wss.twitch.tv')
          this.startTwitch(next, true);
      } else if (type === 'notification' && this.fresh(msg.metadata.message_id)) {
        const e = msg.payload.event;
        const event = msg.payload.subscription.type;
        if (event === 'channel.chat.message')
          this.emit({
            type: 'chat',
            data: {
              id: e.message_id,
              platform: 'twitch',
              user: e.chatter_user_name,
              text: e.message.text,
              color: e.color,
              time: Date.now(),
            },
          });
        else {
          const labels: Record<string, string> = {
            'channel.follow': 'Nový sledující',
            'channel.subscribe': 'Nové předplatné',
            'channel.subscription.gift': 'Darované předplatné',
            'channel.subscription.message': 'Obnovené předplatné',
            'channel.cheer': 'Bits',
            'channel.raid': 'Raid',
          };
          this.emit({
            type: 'alert',
            data: {
              id: msg.metadata.message_id,
              platform: 'twitch',
              user: e.user_name ?? e.from_broadcaster_user_name ?? 'Anonym',
              title: labels[event] ?? event,
              detail: e.bits
                ? `${e.bits} bits`
                : e.total
                  ? `${e.total} předplatných`
                  : e.viewers
                    ? `${e.viewers} diváků`
                    : e.tier
                      ? `Tier ${Number(e.tier) / 1000}`
                      : '',
              time: Date.now(),
            },
          });
        }
      } else if (type === 'revocation')
        this.emit({
          type: 'notice',
          data:
            'Twitch odebral oprávnění pro ' +
            msg.payload.subscription.type +
            '. Připoj účet znovu.',
        });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.twitch !== socket) return;
      this.twitch = undefined;
      clearTimeout(this.twitchWatchdog);
      if (!this.disposed && this.vault.data.accounts.twitch.accessToken)
        this.twitchRetry = setTimeout(() => {
          this.twitchRetry = undefined;
          this.startTwitch();
        }, 10000);
    });
  }
  private async pollYoutube(generation: number) {
    const chatId = this.youtubeChatId;
    if (!chatId || this.disposed || generation !== this.chatGeneration) return;
    let interval = 15000;
    try {
      const params = new URLSearchParams({
        part: 'snippet,authorDetails',
        liveChatId: chatId,
        maxResults: '200',
      });
      if (this.youtubePage) params.set('pageToken', this.youtubePage);
      const result = await this.auth.request('youtube', '/liveChat/messages?' + params);
      if (generation !== this.chatGeneration) return;
      this.youtubePage = result.nextPageToken ?? '';
      interval = Math.max(15000, result.pollingIntervalMillis ?? 0);
      for (const m of result.items ?? []) {
        if (!this.fresh(m.id)) continue;
        const s = m.snippet;
        const user = m.authorDetails?.displayName ?? 'YouTube';
        if (s.type === 'textMessageEvent')
          this.emit({
            type: 'chat',
            data: {
              id: m.id,
              platform: 'youtube',
              user,
              text: s.displayMessage,
              time: Date.parse(s.publishedAt) || Date.now(),
            },
          });
        else if (
          [
            'superChatEvent',
            'superStickerEvent',
            'newSponsorEvent',
            'memberMilestoneChatEvent',
            'membershipGiftingEvent',
            'giftMembershipReceivedEvent',
          ].includes(s.type)
        ) {
          this.emit({
            type: 'alert',
            data: {
              id: m.id,
              platform: 'youtube',
              user,
              title: s.type.includes('super') ? 'Super Chat / Sticker' : 'Členství',
              detail:
                s.superChatDetails?.amountDisplayString ??
                s.superStickerDetails?.amountDisplayString ??
                s.displayMessage ??
                '',
              time: Date.parse(s.publishedAt) || Date.now(),
            },
          });
        }
      }
      if (result.offlineAt) return;
    } catch (error) {
      interval = 60000;
      this.emit({ type: 'notice', data: 'YouTube chat: ' + String(error) });
    }
    if (!this.disposed && generation === this.chatGeneration)
      this.chatTimer = setTimeout(() => void this.pollYoutube(generation), interval);
  }
  private syncRelay() {
    const { relayUrl, relayToken, accounts } = this.vault.data;
    const identity = relayUrl + relayToken + accounts.kick.userId;
    if (identity !== this.relayIdentity) {
      this.relayIdentity = identity;
      this.relay?.close();
      this.relay = undefined;
      clearTimeout(this.relayRetry);
      this.relayRetry = undefined;
    }
    if (!relayUrl || !relayToken || !accounts.kick.accessToken || this.relay || this.relayRetry)
      return;
    const url = new URL('/events', relayUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${relayToken}` } });
    this.relay = socket;
    socket.on('open', () => void this.subscribeKick());
    socket.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (
        msg.platform !== 'kick' ||
        String(msg.payload?.broadcaster?.user_id) !== accounts.kick.userId ||
        !this.fresh(msg.id)
      )
        return;
      const e = msg.payload;
      if (msg.event === 'chat.message.sent')
        this.emit({
          type: 'chat',
          data: {
            id: msg.id,
            platform: 'kick',
            user: e.sender?.username ?? 'Kick',
            text: e.content ?? '',
            color: e.sender?.identity?.username_color,
            time: Date.now(),
          },
        });
      else
        this.emit({
          type: 'alert',
          data: {
            id: msg.id,
            platform: 'kick',
            user:
              e.follower?.username ??
              e.subscriber?.username ??
              e.sender?.username ??
              e.gifter?.username ??
              'Kick',
            title:
              (
                {
                  'channel.followed': 'Nový sledující',
                  'channel.subscription.new': 'Nové předplatné',
                  'channel.subscription.renewal': 'Obnovené předplatné',
                  'channel.subscription.gifts': 'Darované předplatné',
                  'kicks.gifted': 'Kicks',
                } as Record<string, string>
              )[msg.event] ?? msg.event,
            detail: e.gift?.name ?? '',
            time: Date.now(),
          },
        });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.relay !== socket) return;
      this.relay = undefined;
      if (!this.disposed)
        this.relayRetry = setTimeout(() => {
          this.relayRetry = undefined;
          this.syncRelay();
        }, 15000);
    });
  }
  private async subscribeKick() {
    try {
      const userId = Number(this.vault.data.accounts.kick.userId);
      const existing = await this.auth.request(
        'kick',
        `/events/subscriptions?broadcaster_user_id=${userId}`,
      );
      const names = [
        'chat.message.sent',
        'channel.followed',
        'channel.subscription.new',
        'channel.subscription.renewal',
        'channel.subscription.gifts',
        'kicks.gifted',
      ];
      const events = names
        .filter((name) => !existing.data?.some((e: any) => e.event === name && e.version === 1))
        .map((name) => ({ name, version: 1 }));
      if (events.length)
        await this.auth.request('kick', '/events/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcaster_user_id: userId, events, method: 'webhook' }),
        });
    } catch (e) {
      this.emit({ type: 'notice', data: 'Kick webhook: ' + String(e) });
    }
  }
  async sendChat(platform: Platform, text: string) {
    const a = this.vault.data.accounts[platform];
    if (!text.trim() || text.length > 500) throw new Error('Zpráva musí mít 1–500 znaků.');
    if (platform === 'twitch') {
      const result = await this.auth.request(platform, '/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: a.userId, sender_id: a.userId, message: text }),
      });
      if (!result.data?.[0]?.is_sent)
        throw new Error(result.data?.[0]?.drop_reason?.message ?? 'Zpráva nebyla odeslána.');
    } else if (platform === 'youtube') {
      if (!this.youtubeChatId)
        throw new Error('YouTube chat není aktivní. Nejdřív spusť přenos v YouTube Studiu.');
      await this.auth.request(platform, '/liveChat/messages?part=snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: {
            liveChatId: this.youtubeChatId,
            type: 'textMessageEvent',
            textMessageDetails: { messageText: text },
          },
        }),
      });
    } else if (platform === 'kick')
      await this.auth.request(platform, '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcaster_user_id: Number(a.userId),
          content: text,
          type: 'user',
        }),
      });
    else throw new Error('Odesílání do TikTok LIVE není dostupné přes veřejné API.');
  }
  disconnected(platform: Platform) {
    if (platform === 'twitch') {
      clearTimeout(this.twitchRetry);
      this.twitchRetry = undefined;
      this.twitch?.close();
      this.twitch = undefined;
      clearTimeout(this.twitchWatchdog);
    }
    if (platform === 'youtube') {
      this.youtubeChatId = '';
      this.youtubePage = '';
      this.chatGeneration++;
      clearTimeout(this.chatTimer);
    }
    if (platform === 'kick') {
      clearTimeout(this.relayRetry);
      this.relayRetry = undefined;
      this.relay?.close();
      this.relay = undefined;
    }
    this.emit({ type: 'accounts', data: this.vault.view().accounts });
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.chatTimer);
    clearTimeout(this.twitchRetry);
    clearTimeout(this.twitchWatchdog);
    clearTimeout(this.relayRetry);
    this.twitch?.terminate();
    this.relay?.terminate();
  }
}
