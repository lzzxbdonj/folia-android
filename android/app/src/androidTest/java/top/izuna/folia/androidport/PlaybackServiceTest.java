package top.izuna.folia.androidport;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

// Regression: the renderer may stop before starting; that must not start an FGS.
@RunWith(AndroidJUnit4.class)
public class PlaybackServiceTest {
    @Test
    public void stoppingAnIdleServiceNeverStartsIt() {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        final int[] stops = {0};
        Context tracking = new ContextWrapper(target) {
            @Override public boolean stopService(Intent intent) {
                assertEquals(PlaybackService.class.getName(), intent.getComponent().getClassName());
                stops[0]++;
                return false;
            }
            @Override public ComponentName startService(Intent intent) {
                throw new AssertionError("Stopping playback must not start a service");
            }
            @Override public ComponentName startForegroundService(Intent intent) {
                throw new AssertionError("Stopping playback must not create an FGS deadline");
            }
        };
        PlaybackService.send(tracking, PlaybackService.ACTION_STOP, null);
        PlaybackService.send(tracking, PlaybackService.ACTION_STOP, null);
        assertEquals(2, stops[0]);
    }
}
