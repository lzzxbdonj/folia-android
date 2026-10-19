import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Native background playback service.
 *
 * The audio graph stays in the WebView, so this plugin only mirrors what is
 * playing into the Android foreground service that owns the notification, the
 * lock-screen session and the audio focus request. Transport commands come back
 * as "command" events.
 */
export type AndroidPlaybackSnapshot = {
    title: string;
    artist: string;
    album: string;
    /** Absolute http(s) artwork URL. Empty when the cover cannot be fetched natively. */
    artUrl: string;
    playing: boolean;
    durationMs: number;
    positionMs: number;
    canPrev: boolean;
    canNext: boolean;
};

export type AndroidPlaybackCommand = 'play' | 'pause' | 'resume' | 'prev' | 'next';

type FoliaPlayerPlugin = {
    start(options: AndroidPlaybackSnapshot): Promise<void>;
    update(options: AndroidPlaybackSnapshot): Promise<void>;
    stop(): Promise<void>;
    sync(): Promise<void>;
    addListener(
        eventName: 'command',
        listener: (payload: { command: AndroidPlaybackCommand }) => void
    ): Promise<PluginListenerHandle>;
};

export const FoliaPlayer = registerPlugin<FoliaPlayerPlugin>('FoliaPlayer');

/**
 * Native HTTP only understands real URLs, so blob/data covers are dropped: the
 * service falls back to the app icon rather than failing the whole update.
 */
export const toNativeArtworkUrl = (url: string | null | undefined): string => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return '';
    if (url.startsWith('https://') || url.startsWith('http://')) return url;
    try {
        const resolved = new URL(url, document.baseURI);
        return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : '';
    } catch {
        return '';
    }
};
