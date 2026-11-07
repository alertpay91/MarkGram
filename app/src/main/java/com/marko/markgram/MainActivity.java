package com.marko.markgram;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.EditText;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.ContentPermission;
import org.mozilla.geckoview.GeckoSession.PromptDelegate;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebResponse;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    /** Hosts that stay inside the app. Everything else opens in the normal browser. */
    private static final Pattern ALLOWED_HOST = Pattern.compile(
            "(^|\\.)(instagram\\.com|cdninstagram\\.com|ig\\.me|instagr\\.am|fbcdn\\.net"
                    + "|facebook\\.com|fbsbx\\.com|meta\\.com)$");
    private static final Pattern URL_IN_TEXT = Pattern.compile("https?://\\S+");
    private static final int REQUEST_FILE = 1;

    private android.widget.FrameLayout root;
    private GeckoView geckoView;
    private GeckoSession session;
    private boolean canGoBack;
    private String url;
    private boolean fullScreen;
    /** Android sometimes runs two copies of this screen for a moment; only the newest one owns the tabs. */
    private static MainActivity owner;

    private PromptDelegate.FilePrompt pendingFilePrompt;
    private GeckoResult<PromptDelegate.PromptResponse> pendingFileResult;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // GeckoView maps touches wrongly if it has padding itself, so the system-bar insets
        // are applied to a plain container around it instead.
        root = new android.widget.FrameLayout(this);
        geckoView = new GeckoView(this);
        root.addView(geckoView, new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(0xFF000000);
        // Black instead of Gecko's white blank page until Instagram paints.
        geckoView.coverUntilFirstPaint(0xFF000000);
        setContentView(root);
        applyInsets();
        attachSession();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        handleIntent(getIntent());
    }

    private void attachSession() {
        GeckoSession s = App.session(this);
        s.setNavigationDelegate(new NavDelegate());
        s.setContentDelegate(new ContentDelegate());
        s.setPromptDelegate(new Prompts());
        s.setPermissionDelegate(new Permissions());
        session = s;
        owner = this;
        if (geckoView.getSession() != s) {
            if (geckoView.getSession() != null) geckoView.releaseSession();
            geckoView.setSession(s);
        }
        s.setActive(true);
        App.setPageListener(this::onPageMessage);
    }

    private void onPageMessage(org.json.JSONObject msg) {
        if ("download".equals(msg.optString("type"))) saveMedia(msg.optJSONArray("files"));
    }

    // ---- Download button: photos go to Pictures/MarkGram, videos to Movies/MarkGram ----

    private void saveMedia(org.json.JSONArray files) {
        if (files == null || files.length() == 0) return;
        if (Build.VERSION.SDK_INT < 29) {
            Toast.makeText(this, "Preuzimanje traži Android 10 ili noviji", Toast.LENGTH_SHORT).show();
            return;
        }
        final android.content.Context ctx = getApplicationContext();
        Toast.makeText(this, files.length() > 1 ? "Preuzimam " + files.length() + " fajla…" : "Preuzimam…",
                Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            int ok = 0;
            boolean anyVideo = false;
            for (int i = 0; i < files.length(); i++) {
                org.json.JSONObject f = files.optJSONObject(i);
                if (f == null) continue;
                boolean video = f.optBoolean("video");
                anyVideo |= video;
                String name = f.optString("name", "markgram") + (video ? ".mp4" : ".jpg");
                Uri out = null;
                try {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(f.getString("url")).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    if (c.getResponseCode() != 200) throw new java.io.IOException("HTTP " + c.getResponseCode());
                    String type = c.getContentType();
                    if (type == null || !type.contains("/")) type = video ? "video/mp4" : "image/jpeg";
                    type = type.split(";")[0].trim();
                    if (type.equals("image/webp")) name = name.replaceAll("\\.jpg$", ".webp");
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/MarkGram");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri collection = video
                            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    out = ctx.getContentResolver().insert(collection, v);
                    if (out == null) throw new java.io.IOException("insert failed");
                    try (InputStream in = c.getInputStream(); OutputStream os = ctx.getContentResolver().openOutputStream(out)) {
                        byte[] buf = new byte[64 * 1024];
                        for (int n; (n = in.read(buf)) > 0; ) os.write(buf, 0, n);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    ctx.getContentResolver().update(out, done, null, null);
                    ok++;
                } catch (Exception e) {
                    Log.w(App.TAG, "media download failed", e);
                    if (out != null) {
                        try { ctx.getContentResolver().delete(out, null, null); } catch (Exception ignored) { }
                    }
                }
            }
            final int saved = ok, total = files.length();
            final String where = anyVideo ? "galeriju (Movies/MarkGram)" : "galeriju (Pictures/MarkGram)";
            runOnUiThread(() -> Toast.makeText(ctx,
                    saved == total ? "Sačuvano u " + where : saved > 0 ? "Sačuvano " + saved + " od " + total : "Preuzimanje nije uspelo",
                    Toast.LENGTH_SHORT).show());
        }, "media-download").start();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String url = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            url = intent.getDataString();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                Matcher m = URL_IN_TEXT.matcher(text);
                if (m.find()) url = m.group();
            }
        }
        if (url == null || !isAllowed(Uri.parse(url))) return;
        session.loadUri(url);
    }

    // ---- Back button: fullscreen -> page history -> home feed -> leave the app ----

    private void handleBack() {
        // Like the app: back on the home feed leaves (instead of walking back through every tab
        // you visited); everywhere else it goes back one page.
        if (fullScreen) {
            session.exitFullScreen();
        } else if (isHome(url)) {
            moveTaskToBack(true);
        } else if (canGoBack) {
            session.goBack();
        } else {
            session.loadUri(App.HOME);
        }
    }

    private static boolean isHome(String url) {
        if (url == null) return true;
        String path = Uri.parse(url).getPath();
        return path == null || path.isEmpty() || "/".equals(path);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack(); // Android 12 and older
    }

    // ---- Keep the page out from under the status bar, nav bar and keyboard ----

    private void applyInsets() {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (fullScreen) {
                v.setPadding(0, 0, 0, 0);
            } else if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else {
                @SuppressWarnings("deprecation")
                int top = insets.getSystemWindowInsetTop();
                @SuppressWarnings("deprecation")
                int bottom = insets.getSystemWindowInsetBottom();
                v.setPadding(0, top, 0, bottom);
            }
            return insets;
        });
    }

    // ---- Fullscreen video ----

    @SuppressWarnings("deprecation")
    private void setFullScreen(boolean fs) {
        fullScreen = fs;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                if (fs) {
                    c.hide(WindowInsets.Type.systemBars());
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    c.show(WindowInsets.Type.systemBars());
                }
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(fs
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
        setRequestedOrientation(fs ? ActivityInfo.SCREEN_ORIENTATION_SENSOR
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        root.requestApplyInsets();
    }

    // ---- Navigation rules ----

    static boolean isAllowed(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equals(scheme) || "http".equals(scheme))
                && host != null && ALLOWED_HOST.matcher(host.toLowerCase()).find();
    }

    private void openExternally(Uri uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private class NavDelegate implements GeckoSession.NavigationDelegate {
        @Override
        public void onCanGoBack(GeckoSession s, boolean value) {
            canGoBack = value;
        }

        @Override
        public void onLocationChange(GeckoSession s, String url, List<ContentPermission> perms,
                                     Boolean hasUserGesture) {
            if (url != null) MainActivity.this.url = url;
        }

        @Override
        public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest req) {
            Uri uri = Uri.parse(req.uri);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            switch (scheme) {
                case "http":
                case "https":
                    if (isAllowed(uri)) {
                        if (req.target == TARGET_WINDOW_NEW) {
                            s.loadUri(req.uri); // no tabs: open "new window" links in place
                            return GeckoResult.deny();
                        }
                        return GeckoResult.allow();
                    }
                    openExternally(uri);
                    return GeckoResult.deny();
                case "about":
                case "data":
                case "blob":
                case "resource":
                case "moz-extension":
                    return GeckoResult.allow();
                default:
                    // instagram://, fb://, intent:// ... would hand the page to the official apps.
                    if (!scheme.startsWith("instagram") && !scheme.startsWith("fb")
                            && !"intent".equals(scheme)) openExternally(uri);
                    return GeckoResult.deny();
            }
        }
    }

    private class ContentDelegate implements GeckoSession.ContentDelegate {
        @Override
        public void onFullScreen(GeckoSession s, boolean fs) {
            setFullScreen(fs);
        }

        @Override
        public void onCrash(GeckoSession s) {
            recoverSession();
        }

        @Override
        public void onKill(GeckoSession s) {
            recoverSession();
        }

        @Override
        public void onExternalResponse(GeckoSession s, WebResponse response) {
            saveDownload(response);
        }
    }

    private void recoverSession() {
        geckoView.releaseSession();
        session = null;
        App.resetSession();
        canGoBack = false;
        if (fullScreen) setFullScreen(false);
        attachSession();
    }

    // ---- Downloads (e.g. "Save photo") go to the Downloads folder ----

    private void saveDownload(WebResponse response) {
        if (Build.VERSION.SDK_INT < 29 || response.body == null) {
            openExternally(Uri.parse(response.uri));
            return;
        }
        String name = fileName(response);
        String type = response.headers.get("Content-Type");
        Toast.makeText(this, "Preuzimam " + name, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            boolean ok = false;
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                if (type != null) v.put(MediaStore.Downloads.MIME_TYPE, type.split(";")[0].trim());
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri out = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (out != null) {
                    try (InputStream in = response.body; OutputStream os = getContentResolver().openOutputStream(out)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    ok = true;
                }
            } catch (Exception e) {
                Log.w(App.TAG, "download failed", e);
            }
            final boolean done = ok;
            runOnUiThread(() -> Toast.makeText(this,
                    done ? "Sačuvano u Preuzimanja: " + name : "Preuzimanje nije uspelo",
                    Toast.LENGTH_SHORT).show());
        }, "download").start();
    }

    private static String fileName(WebResponse r) {
        String cd = r.headers.get("Content-Disposition");
        if (cd != null) {
            Matcher m = Pattern.compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)").matcher(cd);
            if (m.find()) return Uri.decode(m.group(1));
        }
        String last = Uri.parse(r.uri).getLastPathSegment();
        return last != null && !last.isEmpty() ? last : "markgram-" + System.currentTimeMillis();
    }

    // ---- Page dialogs: alerts, confirmations, dropdowns, file picker, share ----

    private class Prompts implements PromptDelegate {
        @Override
        public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession s, AlertPrompt p) {
            GeckoResult<PromptResponse> r = new GeckoResult<>();
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(p.title).setMessage(p.message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.complete(p.dismiss()))
                    .setOnCancelListener(d -> r.complete(p.dismiss()))
                    .show();
            return r;
        }

        @Override
        public GeckoResult<PromptResponse> onButtonPrompt(GeckoSession s, ButtonPrompt p) {
            GeckoResult<PromptResponse> r = new GeckoResult<>();
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(p.title).setMessage(p.message)
                    .setPositiveButton(android.R.string.ok,
                            (d, w) -> r.complete(p.confirm(ButtonPrompt.Type.POSITIVE)))
                    .setNegativeButton(android.R.string.cancel,
                            (d, w) -> r.complete(p.confirm(ButtonPrompt.Type.NEGATIVE)))
                    .setOnCancelListener(d -> r.complete(p.dismiss()))
                    .show();
            return r;
        }

        @Override
        public GeckoResult<PromptResponse> onTextPrompt(GeckoSession s, TextPrompt p) {
            GeckoResult<PromptResponse> r = new GeckoResult<>();
            EditText input = new EditText(MainActivity.this);
            input.setText(p.defaultValue);
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(p.title).setMessage(p.message).setView(input)
                    .setPositiveButton(android.R.string.ok,
                            (d, w) -> r.complete(p.confirm(input.getText().toString())))
                    .setNegativeButton(android.R.string.cancel, (d, w) -> r.complete(p.dismiss()))
                    .setOnCancelListener(d -> r.complete(p.dismiss()))
                    .show();
            return r;
        }

        @Override
        public GeckoResult<PromptResponse> onBeforeUnloadPrompt(GeckoSession s, BeforeUnloadPrompt p) {
            return GeckoResult.fromValue(p.confirm(AllowOrDeny.ALLOW));
        }

        @Override
        public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession s, ChoicePrompt p) {
            GeckoResult<PromptResponse> r = new GeckoResult<>();
            List<ChoicePrompt.Choice> items = new ArrayList<>();
            flatten(p.choices, items);
            String[] labels = new String[items.size()];
            boolean[] checked = new boolean[items.size()];
            int selected = -1;
            for (int i = 0; i < items.size(); i++) {
                labels[i] = items.get(i).label;
                checked[i] = items.get(i).selected;
                if (checked[i] && selected < 0) selected = i;
            }
            AlertDialog.Builder b = new AlertDialog.Builder(MainActivity.this).setTitle(p.title)
                    .setOnCancelListener(d -> r.complete(p.dismiss()));
            if (p.type == ChoicePrompt.Type.MULTIPLE) {
                b.setMultiChoiceItems(labels, checked, (d, w, on) -> checked[w] = on)
                        .setPositiveButton(android.R.string.ok, (d, w) -> {
                            List<ChoicePrompt.Choice> out = new ArrayList<>();
                            for (int i = 0; i < checked.length; i++) if (checked[i]) out.add(items.get(i));
                            r.complete(p.confirm(out.toArray(new ChoicePrompt.Choice[0])));
                        })
                        .setNegativeButton(android.R.string.cancel, (d, w) -> r.complete(p.dismiss()));
            } else {
                b.setSingleChoiceItems(labels, selected, (d, w) -> {
                    r.complete(p.confirm(items.get(w)));
                    d.dismiss();
                });
            }
            b.show();
            return r;
        }

        private void flatten(ChoicePrompt.Choice[] in, List<ChoicePrompt.Choice> out) {
            if (in == null) return;
            for (ChoicePrompt.Choice c : in) {
                if (c.items != null) flatten(c.items, out);
                else if (!c.separator && !c.disabled) out.add(c);
            }
        }

        @Override
        public GeckoResult<PromptResponse> onFilePrompt(GeckoSession s, FilePrompt p) {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
            String[] types = p.mimeTypes == null ? new String[0] : p.mimeTypes;
            List<String> mimes = new ArrayList<>();
            for (String t : types) if (t != null && t.contains("/")) mimes.add(t);
            if (mimes.size() == 1) {
                i.setType(mimes.get(0));
            } else {
                i.setType("*/*");
                if (!mimes.isEmpty()) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            }
            if (p.type == FilePrompt.Type.MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            GeckoResult<PromptResponse> r = new GeckoResult<>();
            if (pendingFileResult != null) pendingFileResult.complete(pendingFilePrompt.dismiss());
            pendingFilePrompt = p;
            pendingFileResult = r;
            try {
                startActivityForResult(i, REQUEST_FILE);
            } catch (ActivityNotFoundException e) {
                pendingFileResult = null;
                r.complete(p.dismiss());
            }
            return r;
        }

        @Override
        public GeckoResult<PromptResponse> onSharePrompt(GeckoSession s, SharePrompt p) {
            String text = p.uri != null ? p.uri : p.text;
            if (text == null) return GeckoResult.fromValue(p.confirm(SharePrompt.Result.FAILURE));
            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text);
            try {
                startActivity(Intent.createChooser(send, null));
                return GeckoResult.fromValue(p.confirm(SharePrompt.Result.SUCCESS));
            } catch (ActivityNotFoundException e) {
                return GeckoResult.fromValue(p.confirm(SharePrompt.Result.FAILURE));
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE || pendingFileResult == null) return;
        PromptDelegate.FilePrompt p = pendingFilePrompt;
        GeckoResult<PromptDelegate.PromptResponse> r = pendingFileResult;
        pendingFilePrompt = null;
        pendingFileResult = null;
        if (resultCode != RESULT_OK || data == null) {
            r.complete(p.dismiss());
            return;
        }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                uris.add(data.getClipData().getItemAt(i).getUri());
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (uris.isEmpty()) {
            r.complete(p.dismiss());
            return;
        }
        // Gecko can't open content:// URIs from the picker on every site (Instagram DMs and the Facebook inbox
        // fails with "Unrecognized path"), so the files are copied into the app's cache first
        // and handed over as plain files.
        new Thread(() -> {
            File dir = new File(getCacheDir(), "uploads");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            dir.mkdirs();
            List<Uri> files = new ArrayList<>();
            for (int i = 0; i < uris.size(); i++) {
                Uri u = uris.get(i);
                File f = new File(dir, i + "_" + displayName(u));
                try (InputStream in = getContentResolver().openInputStream(u);
                     OutputStream out = new FileOutputStream(f)) {
                    if (in == null) continue;
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    files.add(Uri.fromFile(f));
                } catch (Exception e) {
                    Log.w(App.TAG, "copy upload failed", e);
                }
            }
            runOnUiThread(() -> {
                if (files.isEmpty()) r.complete(p.dismiss());
                else if (p.type == PromptDelegate.FilePrompt.Type.MULTIPLE)
                    r.complete(p.confirm(this, files.toArray(new Uri[0])));
                else r.complete(p.confirm(this, files.get(0)));
            });
        }).start();
    }

    private String displayName(Uri u) {
        String name = null;
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null || name.isEmpty()) name = "file";
        return name.replaceAll("[\\/:*?\"<>|]", "_");
    }

    // ---- No notifications, location, camera or microphone; no autoplay with sound ----

    private static class Permissions implements GeckoSession.PermissionDelegate {
        @Override
        public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission perm) {
            boolean allow = perm.permission == PERMISSION_AUTOPLAY_INAUDIBLE
                    || perm.permission == PERMISSION_PERSISTENT_STORAGE;
            return GeckoResult.fromValue(allow ? ContentPermission.VALUE_ALLOW : ContentPermission.VALUE_DENY);
        }

        @Override
        public void onMediaPermissionRequest(GeckoSession s, String uri, MediaSource[] video,
                                             MediaSource[] audio, MediaCallback callback) {
            callback.reject();
        }

        @Override
        public void onAndroidPermissionsRequest(GeckoSession s, String[] permissions, Callback callback) {
            callback.reject();
        }
    }

    // ---- Nothing runs while the app is in the background ----

    @Override
    protected void onStop() {
        super.onStop();
        if (owner == this && session != null) session.setActive(false);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (owner != this && session != null) {
            // Another copy took the tab over; take it back now that this one is on screen.
            attachSession();
        } else if (session != null && session.isOpen()) {
            session.setActive(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (geckoView != null && owner == this) geckoView.releaseSession();
        if (owner == this) owner = null;
        super.onDestroy();
    }
}
