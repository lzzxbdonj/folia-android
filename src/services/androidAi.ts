import { androidApiFetch, getAndroidRuntime, isAndroidRuntime } from './androidRuntime';

// src/services/androidAi.ts
// The Android half of src/services/aiText.ts. The desktop keeps the API key in
// its main process; here the packaged Node runtime does the same job, so the
// renderer can configure a model and ask for a theme but can never read the key.
// Answers are plain JSON: the surfaces in aiText.ts do the sanitising.

// The answer uses the desktop option names (AI_PROVIDER, OPENAI_API_URL, …) so the
// settings dialog reads it exactly as it reads the Electron one.
export type AndroidAiSettings = Record<string, unknown>;

export interface AndroidAiTestResult {
    ok: boolean;
    message: string;
}

const HOST = 'folio/ai';

async function call<T>(route: string, payload: Record<string, unknown> = {}): Promise<T> {
    const info = await getAndroidRuntime();
    const response = await androidApiFetch(`http://127.0.0.1:${info.port}/${HOST}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`AI host answered ${response.status}`);
    return await response.json() as T;
}

export const isAndroidAiAvailable = (): boolean => isAndroidRuntime();

export const getAndroidAiSettings = async (): Promise<AndroidAiSettings> => {
    const answer = await call<{ settings: AndroidAiSettings }>('settings', { op: 'get' });
    return answer.settings;
};

export const saveAndroidAiSetting = async (key: string, value: unknown): Promise<AndroidAiSettings> => {
    const answer = await call<{ settings: AndroidAiSettings }>('settings', { op: 'set', key, value });
    return answer.settings;
};

export const testAndroidAiConnection = (payload: Record<string, unknown>): Promise<AndroidAiTestResult> =>
    call<AndroidAiTestResult>('test', payload);

export const generateAndroidTheme = async (lyricsText: string, options?: { isPureMusic?: boolean; songTitle?: string }): Promise<unknown> => {
    const answer = await call<{ ok: boolean; theme?: unknown; error?: string }>('theme', { lyricsText, options });
    if (!answer.ok) throw new Error(answer.error || 'Failed to generate theme');
    return answer.theme;
};
