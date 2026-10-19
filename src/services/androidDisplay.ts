import { registerPlugin } from '@capacitor/core';
import { isAndroidRuntime } from './androidRuntime';

/**
 * Screen orientation for the phone shell.
 *
 * The activity handles orientation changes itself (see MainActivity's
 * configChanges), so switching here never reloads the WebView - playback keeps
 * running through a rotation.
 */
export type ScreenOrientationMode = 'auto' | 'portrait' | 'landscape';

type FoliaDisplayPlugin = {
    setOrientation(options: { mode: ScreenOrientationMode }): Promise<{ orientation: 'portrait' | 'landscape' }>;
    getOrientation(): Promise<{ orientation: 'portrait' | 'landscape' }>;
};

const FoliaDisplay = registerPlugin<FoliaDisplayPlugin>('FoliaDisplay');

const STORAGE_KEY = 'folia.android.screenOrientation';

export const getStoredScreenOrientation = (): ScreenOrientationMode => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'auto' || stored === 'portrait' || stored === 'landscape') return stored;
    } catch {
        // Private mode or a cleared profile: fall through to the default.
    }
    return 'auto';
};

export const applyScreenOrientation = async (mode: ScreenOrientationMode): Promise<void> => {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // Not being able to remember the choice must not stop it applying now.
    }
    if (!isAndroidRuntime()) return;
    try {
        await FoliaDisplay.setOrientation({ mode });
    } catch (error) {
        console.warn('[AndroidDisplay] failed to set orientation', error);
    }
};

/** Re-applies the saved choice on launch, because the activity starts unlocked. */
export const restoreScreenOrientation = (): void => {
    if (!isAndroidRuntime()) return;
    void applyScreenOrientation(getStoredScreenOrientation());
};
