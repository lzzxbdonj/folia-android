package top.izuna.folia.androidport;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Owns the process-wide Node instance and its private, writable application files.
final class FoliaNodeRuntime {
    static final int PORT = 39843;
    private static final ExecutorService STARTER = Executors.newSingleThreadExecutor();
    private static boolean attempted;
    private static String token;
    private static Exception failure;
    private static volatile boolean exited;
    private static volatile int exitCode;

    interface Callback {
        void ready(String token);
        void failed(Exception error);
    }

    private FoliaNodeRuntime() {}

    // Serializes concurrent plugin calls across activity recreation without restarting Node.
    static void start(Context context, Callback callback) {
        STARTER.execute(() -> {
            try {
                if (!attempted) {
                    attempted = true;
                    launch(context);
                }
                if (failure != null) throw failure;
                awaitHealth();
                callback.ready(token);
            } catch (Exception error) {
                failure = error;
                recordFailure(context, error);
                callback.failed(error);
            }
        });
    }

    private static void launch(Context context) throws Exception {
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        StringBuilder hex = new StringBuilder(64);
        for (byte value : secret) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        token = hex.toString();

        File root = new File(context.getNoBackupFilesDir(), "folia-runtime");
        File staging = new File(root, "project-staging");
        File project = new File(root, "project");
        ensureDirectory(root);
        removeTree(staging);
        copyAssets(context.getAssets(), "nodejs-project", staging);
        if (!new File(staging, "index.cjs").isFile()) throw new IOException("Missing packaged nodejs-project/index.cjs");
        removeTree(project);
        if (!staging.renameTo(project)) throw new IOException("Cannot install private backend project");
        File data = new File(context.getNoBackupFilesDir(), "folia-data");
        ensureDirectory(data);

        try {
            System.loadLibrary("folia-runtime");
        } catch (UnsatisfiedLinkError error) {
            throw new IOException("Cannot load embedded Node native library for this device", error);
        }
        Thread node = new Thread(() -> {
            try {
                exitCode = nativeStart(new File(project, "index.cjs").getAbsolutePath(), token,
                    project.getAbsolutePath(), data.getAbsolutePath(), context.getCacheDir().getAbsolutePath());
            } catch (Throwable error) {
                // Never log argv, which contains the process secret.
                exitCode = -1;
            } finally {
                exited = true;
            }
        }, "Folia-Node");
        node.start();
    }

    // Authenticates even readiness probes and verifies backend initialization, not just port ownership.
    private static void awaitHealth() throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 60000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (exited) throw new IOException("Embedded Node exited (code " + exitCode + ")");
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL("http://127.0.0.1:" + PORT + "/health").openConnection();
                connection.setConnectTimeout(500);
                connection.setReadTimeout(500);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("X-Folia-Token", token);
                if (connection.getResponseCode() == 200) {
                    JSONObject health;
                    try (InputStream input = connection.getInputStream()) {
                        ByteArrayOutputStream output = new ByteArrayOutputStream();
                        byte[] buffer = new byte[1024];
                        int read;
                        while ((read = input.read(buffer)) != -1) {
                            if (output.size() + read > 16384) throw new IOException("Oversized health response");
                            output.write(buffer, 0, read);
                        }
                        health = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                    }
                    String status = health.optString("status");
                    if ("error".equals(status)) throw new BackendFailure("Embedded backend initialization failed");
                    if ("running".equals(status) && !exited) return;
                }
            } catch (BackendFailure error) {
                throw error;
            } catch (IOException ignored) {
                // A closed socket is expected before Node binds the loopback listener.
            } finally {
                if (connection != null) connection.disconnect();
            }
            Thread.sleep(100);
        }
        throw new IOException("Embedded backend did not become ready within 60 seconds");
    }

    // Keeps a non-secret record of the last startup failure, because some devices withhold app logs.
    private static void recordFailure(Context context, Exception error) {
        StringBuilder text = new StringBuilder();
        text.append("time=").append(new java.util.Date().toString()).append('\n');
        text.append("nodeExit=").append(exitCode).append(" exited=").append(exited).append('\n');
        text.append(error.toString()).append('\n');
        for (StackTraceElement frame : error.getStackTrace()) text.append("  at ").append(frame).append('\n');
        Throwable cause = error.getCause();
        if (cause != null) {
            text.append("cause: ").append(cause).append('\n');
            for (StackTraceElement frame : cause.getStackTrace()) text.append("  at ").append(frame).append('\n');
        }
        File target = new File(context.getNoBackupFilesDir(), "folia-data/last-start-error.txt");
        try {
            ensureDirectory(target.getParentFile());
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(text.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException ignored) {
            // Diagnostics must never replace the original failure.
        }
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private runtime directory");
    }

    private static void copyAssets(AssetManager assets, String source, File destination) throws IOException {
        String[] children = assets.list(source);
        if (children != null && children.length > 0) {
            ensureDirectory(destination);
            for (String name : children) {
                if (name.contains("/") || name.contains("\\") || name.equals("..")) throw new IOException("Invalid asset path");
                copyAssets(assets, source + "/" + name, new File(destination, name));
            }
        } else {
            ensureDirectory(destination.getParentFile());
            try (InputStream input = assets.open(source); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
        }
    }

    private static void removeTree(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        if (!file.delete()) throw new IOException("Cannot replace private backend files");
    }

    private static final class BackendFailure extends IOException {
        BackendFailure(String message) { super(message); }
    }

    private static native int nativeStart(String script, String secret, String project, String data, String temp);
}
