import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PlayerState } from '../types';
import type { SongResult } from '../types';
import { isAndroidRuntime } from '../services/androidRuntime';
import {
    FoliaPlayer,
    toNativeArtworkUrl,
    type AndroidPlaybackCommand,
    type AndroidPlaybackSnapshot,
} from '../services/androidPlayback';
import { getSongAlbumLabel, getSongArtistLabel, getSongCoverUrl } from '../services/onlineMusic/songMetadata';

type UseAndroidPlaybackBridgeOptions = {
    audioRef: RefObject<HTMLAudioElement | null>;
    /** The deck the displayed title belongs to, so position and title always agree. */
    getDisplayAudioElement?: () => HTMLAudioElement | null;
    currentSong: SongResult | null;
    cachedCoverUrl: string | null;
    playerState: PlayerState;
    unknownArtistLabel: string;
    mediaSessionPlayRef: RefObject<() => Promise<void>>;
    mediaSessionPauseRef: RefObject<() => void>;
    mediaSessionPrevRef: RefObject<() => void>;
    mediaSessionNextRef: RefObject<() => Promise<void> | void>;
    isNowPlayingControlDisabledRef: RefObject<boolean>;
};

/** How often the clock is pushed while playing; the system interpolates between updates. */
const POSITION_PUSH_INTERVAL_MS = 5_000;

/**
 * Keeps the Android foreground service in step with what the WebView is playing.
 *
 * Without this the app is just a web page: Android freezes the process once the
 * screen turns off. The service mirrors the track here and hands transport back
 * through "command" events, so the notification and the lock screen drive the
 * exact same audio element the in-app controls do.
 */
export const useAndroidPlaybackBridge = ({
    audioRef,
    getDisplayAudioElement,
    currentSong,
    cachedCoverUrl,
    playerState,
    unknownArtistLabel,
    mediaSessionPlayRef,
    mediaSessionPauseRef,
    mediaSessionPrevRef,
    mediaSessionNextRef,
    isNowPlayingControlDisabledRef,
}: UseAndroidPlaybackBridgeOptions) => {
    const activeRef = useRef(false);
    const lastSnapshotRef = useRef<string>('');

    // Transport commands arrive from the notification, the lock screen, headset
    // buttons and audio-focus handoffs; all of them go through the same refs as
    // the browser Media Session so the two can never disagree.
    useEffect(() => {
        if (!isAndroidRuntime()) return;

        let disposed = false;
        let handle: { remove: () => Promise<void> } | null = null;

        void FoliaPlayer.addListener('command', ({ command }) => {
            if (isNowPlayingControlDisabledRef.current) return;
            const actions: Record<AndroidPlaybackCommand, () => void> = {
                play: () => { void mediaSessionPlayRef.current(); },
                resume: () => { void mediaSessionPlayRef.current(); },
                pause: () => { mediaSessionPauseRef.current(); },
                prev: () => { mediaSessionPrevRef.current(); },
                next: () => { void mediaSessionNextRef.current(); },
            };
            const action = actions[command];
            if (!action) return;
            try {
                action();
            } catch (error) {
                console.warn('[AndroidPlayback] command failed', command, error);
            }
        }).then((registered) => {
            if (disposed) {
                void registered.remove();
                return;
            }
            handle = registered;
        }).catch((error) => {
            console.warn('[AndroidPlayback] listener unavailable', error);
        });

        return () => {
            disposed = true;
            void handle?.remove();
            activeRef.current = false;
            lastSnapshotRef.current = '';
            void FoliaPlayer.stop().catch(() => undefined);
        };
    }, [isNowPlayingControlDisabledRef, mediaSessionNextRef, mediaSessionPauseRef, mediaSessionPlayRef, mediaSessionPrevRef]);

    // Track identity: pushed whenever the visible song, its cover or the play
    // state changes. Also used to start the service the first time a track is
    // loaded, and to tell it to stand down when the queue empties.
    useEffect(() => {
        if (!isAndroidRuntime()) return;

        if (!currentSong) {
            activeRef.current = false;
            lastSnapshotRef.current = '';
            void FoliaPlayer.stop().catch(() => undefined);
            return;
        }

        const audio = getDisplayAudioElement?.() ?? audioRef.current;
        const snapshot: AndroidPlaybackSnapshot = {
            title: currentSong.name,
            artist: getSongArtistLabel(currentSong) || unknownArtistLabel,
            album: getSongAlbumLabel(currentSong),
            artUrl: toNativeArtworkUrl(cachedCoverUrl || getSongCoverUrl(currentSong)),
            playing: playerState === PlayerState.PLAYING,
            durationMs: Math.max(0, Math.round((audio?.duration ?? 0) * 1000)),
            positionMs: Math.max(0, Math.round((audio?.currentTime ?? 0) * 1000)),
            canPrev: true,
            canNext: true,
        };

        // Only identity-bearing fields decide whether this is a new push; the
        // clock is pushed on its own timer so a paused track costs nothing.
        const key = JSON.stringify([snapshot.title, snapshot.artist, snapshot.album, snapshot.artUrl, snapshot.playing]);
        if (key === lastSnapshotRef.current) return;
        lastSnapshotRef.current = key;

        const wasActive = activeRef.current;
        activeRef.current = true;
        const call = wasActive ? FoliaPlayer.update(snapshot) : FoliaPlayer.start(snapshot);
        void call.catch((error) => {
            console.warn('[AndroidPlayback] failed to publish state', error);
        });
    }, [audioRef, cachedCoverUrl, currentSong, getDisplayAudioElement, playerState, unknownArtistLabel]);

    // Clock: the service stores position plus a speed factor, so a coarse push
    // is enough for a smooth progress bar in the notification shade.
    useEffect(() => {
        if (!isAndroidRuntime()) return;
        if (!currentSong || playerState !== PlayerState.PLAYING) return;

        const push = () => {
            if (!activeRef.current) return;
            const audio = getDisplayAudioElement?.() ?? audioRef.current;
            if (!audio) return;
            void FoliaPlayer.update({
                title: currentSong.name,
                artist: getSongArtistLabel(currentSong) || unknownArtistLabel,
                album: getSongAlbumLabel(currentSong),
                artUrl: toNativeArtworkUrl(cachedCoverUrl || getSongCoverUrl(currentSong)),
                playing: true,
                durationMs: Math.max(0, Math.round((audio.duration || 0) * 1000)),
                positionMs: Math.max(0, Math.round(audio.currentTime * 1000)),
                canPrev: true,
                canNext: true,
            }).catch(() => undefined);
        };

        const timer = window.setInterval(push, POSITION_PUSH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [audioRef, cachedCoverUrl, currentSong, getDisplayAudioElement, playerState, unknownArtistLabel]);
};
