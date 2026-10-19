import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

// Native-only transport for the API packaged inside Folia; never patches browser fetch.
interface RuntimeInfo { port: number; token: string }
const runtime = registerPlugin<{ start(): Promise<RuntimeInfo> }>('FoliaRuntime');
export const isAndroidRuntime = (): boolean => Capacitor.getPlatform() === 'android';
let pending: Promise<RuntimeInfo> | undefined;
export const getAndroidRuntime = (): Promise<RuntimeInfo> => {
    if (!pending) {
        pending = runtime.start().catch(error => { pending = undefined; throw error; });
    }
    return pending;
};

export async function androidApiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!isAndroidRuntime()) return fetch(url, options);
    const info = await getAndroidRuntime();
    const target = new URL(url);
    if (target.origin !== `http://127.0.0.1:${info.port}`) throw new Error('Unexpected Android API origin');
    if (options.signal?.aborted) throw (options.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
    const headers = Object.fromEntries(new Headers(options.headers).entries());
    const answer = await CapacitorHttp.request({
        url, method: options.method || 'GET',
        headers: { ...headers, 'X-Folia-Token': info.token },
        ...(options.body ? { data: options.body } : {}),
        responseType: 'text', connectTimeout: 15000, readTimeout: 60000,
    });
    if (options.signal?.aborted) throw (options.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
    return new Response(typeof answer.data === 'string' ? answer.data : JSON.stringify(answer.data), {
        status: answer.status, headers: answer.headers,
    });
}
