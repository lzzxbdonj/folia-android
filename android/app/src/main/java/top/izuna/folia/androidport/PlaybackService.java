package top.izuna.folia.androidport;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Keeps Folia alive and controllable while it is in the background.
 *
 * The audio itself still plays inside the WebView; this service is the part
 * Android needs in order to treat that playback as a real player: a foreground
 * service so the process is not frozen, a MediaSession so the lock screen and
 * the notification shade can drive transport, audio focus so a call or another
 * player takes over cleanly, and a wake lock so the CPU does not nap mid-track.
 *
 * The web layer owns the truth (title, artist, playing state); this service only
 * mirrors it and forwards transport commands back as "command" events.
 */
public class PlaybackService extends Service {
    private static final String TAG = "FoliaPlayback";
    public static final String CHANNEL_ID = "folia-playback";
    public static final int NOTIFICATION_ID = 4101;

    static final String ACTION_START = "top.izuna.folia.androidport.PLAYBACK_START";
    static final String ACTION_UPDATE = "top.izuna.folia.androidport.PLAYBACK_UPDATE";
    static final String ACTION_STOP = "top.izuna.folia.androidport.PLAYBACK_STOP";
    static final String ACTION_TOGGLE = "top.izuna.folia.androidport.PLAYBACK_TOGGLE";
    static final String ACTION_PREV = "top.izuna.folia.androidport.PLAYBACK_PREV";
    static final String ACTION_NEXT = "top.izuna.folia.androidport.PLAYBACK_NEXT";

    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_ARTIST = "artist";
    private static final String EXTRA_ALBUM = "album";
    private static final String EXTRA_ART_URL = "artUrl";
    private static final String EXTRA_PLAYING = "playing";
    private static final String EXTRA_DURATION = "durationMs";
    private static final String EXTRA_POSITION = "positionMs";
    private static final String EXTRA_CAN_PREV = "canPrev";
    private static final String EXTRA_CAN_NEXT = "canNext";

    /** Set by FoliaPlayerPlugin while the app is attached. */
    static volatile TransportListener listener;
    private static volatile PlaybackService instance;

    interface TransportListener {
        void onTransportCommand(String command);
    }

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService artworkLoader = Executors.newSingleThreadExecutor();

    private String title = "";
    private String artist = "";
    private String album = "";
    private String artUrl = "";
    private String loadedArtUrl = "";
    private Bitmap artwork;
    private boolean playing;
    private boolean canPrev;
    private boolean canNext;
    private long durationMs;
    private long positionMs;

    static void send(Context context, String action, Intent extras) {
        Intent intent = new Intent(context, PlaybackService.class).setAction(action);
        // Stop is idempotent and must never create a foreground-service deadline.
        // The renderer sends it before any track exists and during effect cleanup.
        if (ACTION_STOP.equals(action)) {
            context.stopService(intent);
            return;
        }
        if (extras != null) intent.putExtras(extras);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        createSession();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE.equals(action)) {
            emit(playing ? "pause" : "play");
            return START_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            emit("prev");
            return START_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            emit("next");
            return START_STICKY;
        }
        if (ACTION_START.equals(action) || ACTION_UPDATE.equals(action)) {
            readState(intent);
            startForeground(NOTIFICATION_ID, buildNotification());
            pushState();
            // WebView is the audio output and already owns Android audio focus.
            // A second request here steals focus from Chromium and pauses itself.
            if (playing) acquireWakeLock();
            else releaseWakeLock();
            return START_STICKY;
        }
        return START_STICKY;
    }

    private void readState(Intent intent) {
        title = stringExtra(intent, EXTRA_TITLE, title);
        artist = stringExtra(intent, EXTRA_ARTIST, artist);
        album = stringExtra(intent, EXTRA_ALBUM, album);
        String nextArt = stringExtra(intent, EXTRA_ART_URL, artUrl);
        playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
        durationMs = intent.getLongExtra(EXTRA_DURATION, durationMs);
        positionMs = intent.getLongExtra(EXTRA_POSITION, positionMs);
        canPrev = intent.getBooleanExtra(EXTRA_CAN_PREV, canPrev);
        canNext = intent.getBooleanExtra(EXTRA_CAN_NEXT, canNext);
        if (!nextArt.equals(artUrl)) {
            artUrl = nextArt;
            artwork = null;
            loadArtwork();
        }
    }

    private static String stringExtra(Intent intent, String key, String fallback) {
        String value = intent.getStringExtra(key);
        return value == null ? fallback : value;
    }

    private void emit(String command) {
        TransportListener current = listener;
        if (current != null) {
            current.onTransportCommand(command);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("锁屏与通知栏的播放控制");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void createSession() {
        session = new MediaSession(this, "FoliaPlayback");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emit("play"); }
            @Override public void onPause() { emit("pause"); }
            @Override public void onSkipToNext() { emit("next"); }
            @Override public void onSkipToPrevious() { emit("prev"); }
            @Override public void onStop() { emit("pause"); }
        });
        session.setActive(true);
    }

    private PendingIntent commandIntent(String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, action.hashCode(), intent, flags);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title.isEmpty() ? "Folia" : title)
                .setContentText(artist)
                .setSubText(album)
                .setContentIntent(contentIntent)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setShowWhen(false)
                .setOngoing(playing);

        if (artwork != null) builder.setLargeIcon(artwork);

        builder.addAction(transportAction(android.R.drawable.ic_media_previous, "上一首", ACTION_PREV));
        builder.addAction(playing
                ? transportAction(android.R.drawable.ic_media_pause, "暂停", ACTION_TOGGLE)
                : transportAction(android.R.drawable.ic_media_play, "播放", ACTION_TOGGLE));
        builder.addAction(transportAction(android.R.drawable.ic_media_next, "下一首", ACTION_NEXT));

        Notification.MediaStyle style = new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);
        builder.setStyle(style);
        return builder.build();
    }

    private Notification.Action transportAction(int icon, String label, String action) {
        return new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, icon),
                label,
                commandIntent(action)).build();
    }

    private void pushState() {
        if (session == null) return;

        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (canPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (canNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;

        PlaybackState.Builder state = new PlaybackState.Builder()
                .setActions(actions)
                .setState(
                        playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        positionMs,
                        playing ? 1f : 0f,
                        SystemClock.elapsedRealtime());
        session.setPlaybackState(state.build());

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void loadArtwork() {
        final String url = artUrl;
        if (url.isEmpty()) return;
        artworkLoader.execute(() -> {
            Bitmap bitmap = fetchBitmap(url);
            if (bitmap == null) return;
            loadedArtUrl = url;
            if (!url.equals(artUrl)) return; // a newer track won the race
            artwork = bitmap;
            pushState();
        });
    }

    private Bitmap fetchBitmap(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            try (InputStream stream = connection.getInputStream()) {
                return BitmapFactory.decodeStream(stream);
            }
        } catch (Exception error) {
            Log.w(TAG, "artwork fetch failed: " + error.getMessage());
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power == null) return;
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "folia:playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        instance = null;
        releaseWakeLock();
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        artworkLoader.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
