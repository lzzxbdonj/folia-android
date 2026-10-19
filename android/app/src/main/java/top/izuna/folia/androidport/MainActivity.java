package top.izuna.folia.androidport;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.Locale;

// Registers the local-only runtime bridge before Capacitor creates its WebView,
// then wraps Capacitor's own client so installed plugin files can be served
// from app-private storage under the app origin. Every other request still goes
// through Capacitor untouched.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FoliaRuntimePlugin.class);
        registerPlugin(FoliaPlayerPlugin.class);
        registerPlugin(FoliaDisplayPlugin.class);
        super.onCreate(savedInstanceState);
        wrapWebViewClient();
        exposeSafeAreaInsets();
        askForNotificationPermission();
    }

    /**
     * The playback notification is what makes this a real background player, so
     * ask for it once on first launch instead of failing silently later.
     */
    private void askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 0x4f4c);
    }

    private void wrapWebViewClient() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse modded = ModFileServer.serve(getBridge(), request);
                if (modded != null) return modded;
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    /**
     * Android draws the app edge to edge, but the WebView does not expose the
     * system bar or cutout sizes through env(safe-area-inset-*). Publish them as
     * CSS variables instead so the shell and the landscape play bar can stay out
     * from under the status bar and the navigation bar.
     */
    private void exposeSafeAreaInsets() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final WebView webView = getBridge().getWebView();
        final float density = getResources().getDisplayMetrics().density;

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, compat) -> {
            Insets bars = compat.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets cutout = compat.getInsets(WindowInsetsCompat.Type.displayCutout());
            int top = Math.max(bars.top, cutout.top);
            int bottom = Math.max(bars.bottom, cutout.bottom);
            int left = Math.max(bars.left, cutout.left);
            int right = Math.max(bars.right, cutout.right);

            String js = String.format(Locale.US,
                    "(()=>{const s=document.documentElement.style;"
                            + "s.setProperty('--folia-inset-top','%.2fpx');"
                            + "s.setProperty('--folia-inset-right','%.2fpx');"
                            + "s.setProperty('--folia-inset-bottom','%.2fpx');"
                            + "s.setProperty('--folia-inset-left','%.2fpx');})()",
                    top / density, right / density, bottom / density, left / density);
            view.post(() -> webView.evaluateJavascript(js, null));
            return compat;
        });
    }
}
