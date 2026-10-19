package top.izuna.folia.androidport;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Exposes only runtime startup; HTTP requests explicitly use CapacitorHttp in TypeScript.
@CapacitorPlugin(name = "FoliaRuntime")
public class FoliaRuntimePlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        FoliaNodeRuntime.start(getContext().getApplicationContext(), new FoliaNodeRuntime.Callback() {
            @Override
            public void ready(String token) {
                JSObject result = new JSObject();
                result.put("port", FoliaNodeRuntime.PORT);
                result.put("token", token);
                call.resolve(result);
            }

            @Override
            public void failed(Exception error) {
                call.reject("Embedded backend unavailable; close and reopen the app if startup failed.", "RUNTIME_START_FAILED", error);
            }
        });
    }
}
