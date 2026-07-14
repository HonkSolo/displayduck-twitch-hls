import Hls from 'hls.js';
import {
  invokeBackendCommand,
  signal,
  type WidgetContext,
} from '@displayduck/base';

type WidgetConfig = Record<string, unknown>;

type LiveMeta = {
  isLive: boolean;
};

export class DisplayDuckWidget {
  private static readonly TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  private static readonly LIVE_POLL_INTERVAL_MS = 5000;
  private static readonly MAX_NETWORK_RETRIES = 2;
  private static readonly LISTEN_ADDR = '127.0.0.1:8788';

  public readonly channel = signal('');
  public readonly autoHide = signal(false);
  public readonly streamUrl = signal('');
  public readonly streamError = signal('');
  public readonly streamIsLive = signal(false);
  public readonly streamLiveStatusChecked = signal(false);
  public readonly streamVideoReady = signal(false);

  private readonly ctx: WidgetContext;
  private config: WidgetConfig = {};
  private hls: Hls | null = null;
  private player: HTMLVideoElement | null = null;
  private videoReadyPlayer: HTMLVideoElement | null = null;
  private attachedUrl = '';
  private streamChannel = '';
  private activeStreamChannel = '';
  private networkRetries = 0;
  private liveStatusInterval: ReturnType<typeof setInterval> | null = null;
  private liveStatusCheckInFlight = false;
  private reconcileSequence = 0;

  public constructor(ctx: WidgetContext) {
    this.ctx = ctx;
    this.applyPayload(ctx.payload);
  }

  public onInit(): void {
    this.ctx.on('contextmenu', '.stream-video', (event) => event.preventDefault());
    this.ctx.on('loadeddata', '.stream-video', () => this.onStreamVideoReady());
    this.ctx.on('canplay', '.stream-video', () => this.onStreamVideoReady());
    this.ctx.on('playing', '.stream-video', () => this.onStreamVideoReady());
    void this.reconcileStream();
  }

  public onUpdate(payload: Record<string, unknown>): void {
    this.applyPayload(payload);
    void this.reconcileStream();
  }

  public afterRender(): void {
    const player = this.ctx.mount.querySelector<HTMLVideoElement>('.stream-video');
    if (!player) {
      this.detachVideoReadyListeners();
      this.player = null;
      this.attachedUrl = '';
      return;
    }

    this.attachVideoReadyListeners(player);

    const url = this.streamUrl();
    if (url && (player !== this.player || url !== this.attachedUrl)) {
      this.attachStreamToVideo(player, url);
    }
  }

  public onDestroy(): void {
    this.stopLiveStatusPolling();
    this.stopStreamPlayback();
    this.detachVideoReadyListeners();
  }

  private attachVideoReadyListeners(player: HTMLVideoElement): void {
    if (this.videoReadyPlayer === player) {
      return;
    }

    this.detachVideoReadyListeners();
    player.addEventListener('loadeddata', this.onStreamVideoReady);
    player.addEventListener('canplay', this.onStreamVideoReady);
    player.addEventListener('playing', this.onStreamVideoReady);
    this.videoReadyPlayer = player;
  }

  private detachVideoReadyListeners(): void {
    if (!this.videoReadyPlayer) {
      return;
    }

    this.videoReadyPlayer.removeEventListener('loadeddata', this.onStreamVideoReady);
    this.videoReadyPlayer.removeEventListener('canplay', this.onStreamVideoReady);
    this.videoReadyPlayer.removeEventListener('playing', this.onStreamVideoReady);
    this.videoReadyPlayer = null;
  }

  public shouldRenderStream(): boolean {
    return !this.autoHide() || this.streamIsLive() || !this.streamLiveStatusChecked();
  }

  private applyPayload(payload: Record<string, unknown> | undefined): void {
    const root = payload ?? {};
    const nestedConfig = root.config;
    this.config = nestedConfig && typeof nestedConfig === 'object' && !Array.isArray(nestedConfig)
      ? nestedConfig as WidgetConfig
      : root;

    const nextChannel = this.normalizeChannel(this.readString('channel'));
    const nextAutoHide = this.readBoolean('autoHide');
    this.channel.set(nextChannel);
    this.autoHide.set(nextAutoHide);
  }

  private readString(key: string): string {
    const value = this.config[key];
    return typeof value === 'string' ? value : '';
  }

  private readBoolean(key: string): boolean {
    return this.config[key] === true;
  }

  private normalizeChannel(value: string): string {
    const raw = value.trim();
    if (!raw) {
      return '';
    }

    let channel = raw;
    if (/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//i.test(raw)) {
      try {
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        channel = url.pathname.split('/').find(Boolean) ?? '';
      } catch {
        channel = raw;
      }
    }

    return channel
      .replace(/^@/, '')
      .split(/[/?#\s]/, 1)[0]
      .trim()
      .toLowerCase();
  }

  private async reconcileStream(): Promise<void> {
    const sequence = ++this.reconcileSequence;
    const channel = this.channel();

    if (channel !== this.streamChannel) {
      this.stopStreamPlayback(false);
      this.stopLiveStatusPolling();
      this.streamChannel = channel;
      this.streamLiveStatusChecked.set(false);
      this.streamIsLive.set(false);
    }

    if (!channel) {
      this.stopStreamPlayback(false);
      this.stopLiveStatusPolling();
      return;
    }

    this.startLiveStatusPolling();
    await this.pollLiveStatus(sequence);
  }

  private startLiveStatusPolling(): void {
    if (this.liveStatusInterval) {
      return;
    }

    this.liveStatusInterval = setInterval(() => {
      void this.pollLiveStatus(this.reconcileSequence);
    }, DisplayDuckWidget.LIVE_POLL_INTERVAL_MS);
  }

  private stopLiveStatusPolling(): void {
    if (this.liveStatusInterval) {
      clearInterval(this.liveStatusInterval);
      this.liveStatusInterval = null;
    }
    this.liveStatusCheckInFlight = false;
  }

  private async pollLiveStatus(sequence: number): Promise<void> {
    if (this.liveStatusCheckInFlight || !this.streamChannel) {
      return;
    }

    this.liveStatusCheckInFlight = true;
    const channel = this.streamChannel;

    try {
      let meta: LiveMeta;
      try {
        meta = await this.getChannelLiveMeta(channel);
      } catch (error) {
        if (sequence === this.reconcileSequence && channel === this.streamChannel) {
          this.streamLiveStatusChecked.set(true);
          this.streamIsLive.set(false);
          this.streamVideoReady.set(false);
          this.stopStreamPlayback(false);
          this.streamError.set(`Live status check failed: ${this.errorMessage(error)}`);
        }
        return;
      }
      if (sequence !== this.reconcileSequence || channel !== this.streamChannel) {
        return;
      }

      const wasLive = this.streamIsLive();
      this.streamLiveStatusChecked.set(true);
      this.streamIsLive.set(meta.isLive);
      this.streamError.set('');

      if (!meta.isLive) {
        this.streamVideoReady.set(false);
        if (wasLive || this.activeStreamChannel === channel || this.hls) {
          this.stopStreamPlayback(false);
        }
        return;
      }

      if (
        this.activeStreamChannel === channel
        && this.streamUrl()
        && (this.hls || Boolean(this.player?.src))
      ) {
        return;
      }

      await this.startStreamPlayback(channel, sequence);
    } finally {
      this.liveStatusCheckInFlight = false;
    }
  }

  private async getChannelLiveMeta(channel: string): Promise<LiveMeta> {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': DisplayDuckWidget.TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        operationName: 'StreamMetadata',
        variables: { channelLogin: channel },
        query: `query StreamMetadata($channelLogin: String!) {
          user(login: $channelLogin) { stream { id } }
        }`,
      }]),
    });

    if (!response.ok) {
      throw new Error(`Twitch live status request failed (${response.status})`);
    }

    const json = await response.json() as Array<{
      data?: { user?: { stream?: { id?: string | null } | null } | null };
    }>;
    return { isLive: Boolean(json?.[0]?.data?.user?.stream?.id) };
  }

  private async startStreamPlayback(channel: string, sequence: number): Promise<void> {
    try {
      this.streamVideoReady.set(false);
      const url = await this.startBackendStream(channel);
      if (sequence !== this.reconcileSequence || channel !== this.streamChannel) {
        return;
      }
      if (!url.startsWith(`http://${DisplayDuckWidget.LISTEN_ADDR}/`)) {
        throw new Error(`Unexpected stream URL from backend: ${url}`);
      }

      this.networkRetries = 0;
      this.streamUrl.set(url);
      this.streamError.set('');
      this.attachStreamToVideo(this.findPlayer(), url);
      this.activeStreamChannel = channel;
    } catch (error) {
      this.streamUrl.set('');
      this.streamError.set(this.errorMessage(error));
      this.streamVideoReady.set(false);
      this.activeStreamChannel = '';
    }
  }

  private attachStreamToVideo(player: HTMLVideoElement | null, url: string): void {
    if (!player) {
      return;
    }

    if (player === this.player && url === this.attachedUrl && (this.hls || player.src === url)) {
      return;
    }

    player.defaultMuted = true;
    player.muted = true;
    player.volume = 0;
    this.hls?.destroy();
    this.hls = null;
    this.player = player;
    this.attachedUrl = url;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(player);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void player.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }

        this.streamError.set(this.getHlsErrorDetails(data));
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.networkRetries < DisplayDuckWidget.MAX_NETWORK_RETRIES) {
            this.networkRetries += 1;
            void this.refreshHlsUrl();
            return;
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        hls.destroy();
        if (this.hls === hls) {
          this.hls = null;
          this.activeStreamChannel = '';
        }
      });
      this.hls = hls;
      return;
    }

    if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = url;
      player.load();
      void player.play().catch(() => {});
      return;
    }

    this.streamError.set('HLS is not supported in this environment.');
  }

  private async refreshHlsUrl(): Promise<void> {
    const channel = this.streamChannel;
    if (!channel) {
      return;
    }

    try {
      const url = await this.startBackendStream(channel);
      if (channel !== this.streamChannel || !this.streamIsLive()) {
        return;
      }
      this.streamUrl.set(url);
      this.streamError.set('');
      this.attachStreamToVideo(this.findPlayer(), url);
    } catch (error) {
      this.streamError.set(`HLS URL refresh failed: ${this.errorMessage(error)}`);
    }
  }

  private stopStreamPlayback(clearChannel = true): void {
    const player = this.player;

    if (clearChannel) {
      this.streamChannel = '';
    }
    this.activeStreamChannel = '';
    this.networkRetries = 0;
    this.hls?.destroy();
    this.hls = null;
    this.player = null;
    this.attachedUrl = '';

    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }

    void this.stopBackendStream();
    this.streamUrl.set('');
    this.streamError.set('');
    this.streamVideoReady.set(false);
  }

  private findPlayer(): HTMLVideoElement | null {
    return this.ctx.mount.querySelector<HTMLVideoElement>('.stream-video');
  }

  private startBackendStream(channel: string): Promise<string> {
    return invokeBackendCommand<string>('controller_stream_start', {
      streamUrl: `twitch://${channel}`,
      listenAddr: DisplayDuckWidget.LISTEN_ADDR,
    });
  }

  private async stopBackendStream(): Promise<void> {
    await invokeBackendCommand('controller_stream_stop').catch(() => {});
  }

  private onStreamVideoReady = (): void => {
    this.streamVideoReady.set(true);
  };

  private getHlsErrorDetails(data: any): string {
    const code = data?.response?.code ? ` (${data.response.code})` : '';
    const detail = data?.details ? ` ${data.details}` : '';
    const reason = data?.error?.text ? ` ${data.error.text}` : '';
    return `HLS error: ${data?.type ?? 'unknown'}${code}${detail}${reason}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
