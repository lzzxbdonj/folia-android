package top.izuna.folia.androidport;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Orientation control for the shell: portrait, landscape, or follow the phone.
 *
 * "auto" follows the device sensor including the reverse-landscape side, which
 * is what a phone held upside down in a car mount needs. "landscape" still lets
 * the user flip between the two landscape sides but never falls back to portrait.
 */
@CapacitorPlugin(name = "FoliaDisplay")
public class FoliaDisplayPlugin extends Plugin {

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "auto");
        int requested;
        switch (mode == null ? "auto" : mode) {
            case "portrait":
                requested = ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT;
                break;
            case "landscape":
                requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
                break;
            case "locked-landscape":
                requested = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
                break;
            case "locked-portrait":
                requested = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                break;
            default:
                requested = ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
                break;
        }
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(requested));
        call.resolve(current());
    }

    @PluginMethod
    public void getOrientation(PluginCall call) {
        call.resolve(current());
    }

    private JSObject current() {
        JSObject result = new JSObject();
        int orientation = getActivity().getResources().getConfiguration().orientation;
        result.put("orientation",
                orientation == Configuration.ORIENTATION_LANDSCAPE ? "landscape" : "portrait");
        return result;
    }
}
