package top.izuna.folia.androidport;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

// Runs on a device/emulator and exercises the real packaged Node runtime, not a host substitute.
@RunWith(AndroidJUnit4.class)
public class FoliaRuntimeTest {
    @Test
    public void startsOnceAndAuthenticatesHealth() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String first = start(context);
        assertTrue("Expected 256-bit hexadecimal process secret", first.matches("[0-9a-f]{64}"));
        assertTrue("Repeated calls must reuse the same runtime", first.equals(start(context)));
        assertEquals(200, health(first));
        assertEquals(401, health(null));
        assertEquals(401, health("invalid-token"));
    }

    private static String start(Context context) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> token = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        FoliaNodeRuntime.start(context, new FoliaNodeRuntime.Callback() {
            @Override
            public void ready(String value) { token.set(value); done.countDown(); }
            @Override
            public void failed(Exception error) { failure.set(error); done.countDown(); }
        });
        assertTrue("Node readiness timed out", done.await(75, TimeUnit.SECONDS));
        if (failure.get() != null) throw failure.get();
        return token.get();
    }

    private static int health(String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:39843/health").openConnection();
        try {
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setInstanceFollowRedirects(false);
            if (token != null) connection.setRequestProperty("X-Folia-Token", token);
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }
}
