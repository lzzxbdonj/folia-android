package top.izuna.folia.androidport;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JavaScript side of the background playback service.
 *
 * The web layer pushes what it is playing down here, and receives transport
 * commands (lock screen, notification, headset buttons, audio focus) back as
 * "command" events so it can drive its own audio element.
 */
@CapacitorPlugin(name = "FoliaPlayer")
public class FoliaPlayerPlugin extends Plugin {
    private Bundle lastState;

    @Override
    public void load() {
        PlaybackService.listener = command -> {
            JSObject payload = new JSObject();
            payload.put("command", command);
            notifyListeners("command", payload);
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        Bundle extras = readState(call);
        lastState = extras;
        ensureNotificationPermission();
        PlaybackService.send(getContext(), PlaybackService.ACTION_START, toIntent(extras));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        Bundle extras = readState(call);
        lastState = extras;
        PlaybackService.send(getContext(), PlaybackService.ACTION_UPDATE, toIntent(extras));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        lastState = null;
        PlaybackService.send(getContext(), PlaybackService.ACTION_STOP, null);
        call.resolve();
    }

    /** Lets the web layer re-sync after the WebView was recreated. */
    @PluginMethod
    public void sync(PluginCall call) {
        if (lastState == null) {
            call.resolve();
            return;
        }
        PlaybackService.send(getContext(), PlaybackService.ACTION_UPDATE, toIntent(lastState));
        call.resolve();
    }

    private Intent toIntent(Bundle extras) {
        return new Intent().putExtras(extras);
    }

    private Bundle readState(PluginCall call) {
        Bundle extras = new Bundle();
        extras.putString("title", call.getString("title", ""));
        extras.putString("artist", call.getString("artist", ""));
        extras.putString("album", call.getString("album", ""));
        extras.putString("artUrl", call.getString("artUrl", ""));
        extras.putBoolean("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        extras.putLong("durationMs", longValue(call, "durationMs"));
        extras.putLong("positionMs", longValue(call, "positionMs"));
        extras.putBoolean("canPrev", Boolean.TRUE.equals(call.getBoolean("canPrev", false)));
        extras.putBoolean("canNext", Boolean.TRUE.equals(call.getBoolean("canNext", false)));
        return extras;
    }

    private long longValue(PluginCall call, String key) {
        Double value = call.getDouble(key);
        return value == null ? 0L : value.longValue();
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        getActivity().runOnUiThread(() -> getActivity().requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, 0x4f4c));
    }
}
