import { getAndroidAiSettings, isAndroidAiAvailable, saveAndroidAiSetting } from './androidAi';

// src/services/androidSettingsHost.ts
// The {@code getSettings / saveSettings} pair the settings dialog uses on the
// desktop, answered by the packaged runtime on Android. Only the AI keys mean
// anything here; every other option stays in the store that already holds it,
// so a save of an unrelated toggle is accepted and does nothing.

type SettingsHost = {
    getSettings: () => Promise<Record<string, unknown>>;
    saveSettings: (key: string, value: unknown) => Promise<Record<string, unknown> | undefined>;
};

export const androidSettingsHost: SettingsHost = {
    getSettings: () => getAndroidAiSettings(),
    saveSettings: async (key, value) => {
        if (!isAndroidAiAvailable()) return undefined;
        const settings = await saveAndroidAiSetting(key, value);
        return settings;
    },
};
