package top.izuna.folia.androidport;

import android.content.Context;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import com.getcapacitor.Bridge;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// Serves installed plugins to the WebView from app-private storage under the
// app's own origin (https://localhost/__folia_mods__/<id>/<file>).
//
// Plugin clients are ES modules that import each other and vendor files by
// relative path, so they have to come from the same origin as the page; a
// loopback HTTP server would be blocked as mixed content. Everything else is
// still Capacitor's own handler: this only answers that one path prefix.
final class ModFileServer {
    private static final String PREFIX = "/__folia_mods__/";
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("mjs", "text/javascript");
        MIME.put("js", "text/javascript");
        MIME.put("cjs", "text/javascript");
        MIME.put("json", "application/json");
        MIME.put("css", "text/css");
        MIME.put("map", "application/json");
        MIME.put("html", "text/html");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("gif", "image/gif");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("wasm", "application/wasm");
        MIME.put("txt", "text/plain");
    }

    private ModFileServer() {}

    // Returns the answer for a plugin file, or null to let Capacitor handle the request.
    static WebResourceResponse serve(Bridge bridge, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        String host = request.getUrl().getHost();
        String path = request.getUrl().getPath();
        if (!"localhost".equals(host) || path == null || !path.startsWith(PREFIX)) return null;
        if (!"GET".equalsIgnoreCase(request.getMethod())) return notFound();

        Context context = bridge.getContext();
        File root = new File(context.getNoBackupFilesDir(), "folia-data/mods");
        String relative;
        try {
            relative = URLDecoder.decode(path.substring(PREFIX.length()), StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            return notFound();
        }
        // Plugin ids and file paths are both plain relative paths; refuse escapes.
        if (relative.isEmpty() || relative.indexOf('\0') >= 0 || relative.contains("..")) return notFound();
        File target = new File(root, relative);
        try {
            String canonicalRoot = root.getCanonicalPath() + File.separator;
            if (!target.getCanonicalPath().startsWith(canonicalRoot)) return notFound();
        } catch (IOException error) {
            return notFound();
        }
        if (!target.isFile()) return notFound();
        if (target.length() > 32L * 1024 * 1024) return notFound();

        String name = target.getName().toLowerCase(Locale.ROOT);
        int dot = name.lastIndexOf('.');
        String mime = dot >= 0 ? MIME.get(name.substring(dot + 1)) : null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("X-Content-Type-Options", "nosniff");
        try {
            return new WebResourceResponse(
                mime == null ? "application/octet-stream" : mime,
                "utf-8",
                200,
                "OK",
                headers,
                new FileInputStream(target)
            );
        } catch (Exception error) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
            new java.io.ByteArrayInputStream(new byte[0]));
    }
}
