import type { CapacitorConfig } from '@capacitor/cli';

// Packages Folia locally; the music API also runs inside this Android application.
const config: CapacitorConfig = {
    appId: 'top.izuna.folia.androidport',
    appName: 'Folia',
    webDir: 'dist',
    backgroundColor: '#09090b',
    server: { androidScheme: 'https', hostname: 'localhost' },
    android: { allowMixedContent: false },
    plugins: {
        CapacitorHttp: { enabled: false },
    },
};

export default config;
