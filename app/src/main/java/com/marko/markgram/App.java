package com.marko.markgram;

import android.app.Application;
import android.content.Context;
import android.util.Log;

import org.json.JSONObject;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebExtensionController;

import java.util.HashSet;
import java.util.Set;

/** One Gecko engine and one Instagram tab for the whole process. */
public class App extends Application {
    static final String TAG = "MarkGram";
    static final String HOME = "https://www.instagram.com/";

    /** {addon id, addons.mozilla.org slug}: installed (AMO-signed) on first start, updated later. */
    private static final String[][] EXTENSIONS = {
            {"uBlock0@raymondhill.net", "ublock-origin"},
    };

    private static GeckoRuntime runtime;
    private static GeckoSession session;
    private static WebExtension helper;
    private static WebExtension.Port port;

    static GeckoRuntime runtime(Context ctx) {
        if (runtime == null) {
            GeckoRuntimeSettings settings = new GeckoRuntimeSettings.Builder()
                    .consoleOutput(false)
                    .loginAutofillEnabled(false)
                    .build();
            runtime = GeckoRuntime.create(ctx.getApplicationContext(), settings);
            setupExtensions(runtime);
        }
        return runtime;
    }

    static boolean hasSession() {
        return session != null && session.isOpen();
    }

    static GeckoSession session(Context ctx) {
        if (!hasSession()) {
            GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                    .usePrivateMode(false)
                    .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_MOBILE)
                    .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
                    .build();
            session = new GeckoSession(settings);
            session.open(runtime(ctx));
            attachHelper(session);
            session.loadUri(HOME);
        }
        return session;
    }

    static void resetSession() {
        if (session != null) {
            try { session.close(); } catch (Exception ignored) { }
        }
        session = null;
        port = null;
    }

    private static void setupExtensions(GeckoRuntime rt) {
        WebExtensionController controller = rt.getWebExtensionController();
        controller.setPromptDelegate(new WebExtensionController.PromptDelegate() {
            @Override
            public GeckoResult<WebExtension.PermissionPromptResponse> onInstallPromptRequest(
                    WebExtension ext, String[] perms, String[] origins, String[] data) {
                // Only our own fixed list of extensions is ever installed.
                return GeckoResult.fromValue(new WebExtension.PermissionPromptResponse(true, false, false));
            }

            @Override
            public GeckoResult<AllowOrDeny> onUpdatePrompt(
                    WebExtension ext, String[] perms, String[] origins, String[] data) {
                return GeckoResult.allow();
            }

            @Override
            public GeckoResult<AllowOrDeny> onOptionalPrompt(
                    WebExtension ext, String[] perms, String[] origins, String[] data) {
                return GeckoResult.allow();
            }
        });

        controller.ensureBuiltIn("resource://android/assets/extensions/helper/", "helper@markgram.marko")
                .accept(ext -> {
                    helper = ext;
                    attachHelper(session);
                }, t -> Log.e(TAG, "helper extension failed", t));

        controller.list().accept(installed -> {
            Set<String> ids = new HashSet<>();
            if (installed != null) {
                for (WebExtension ext : installed) {
                    ids.add(ext.id);
                    Log.i(TAG, "extension installed: " + ext.id + " enabled=" + ext.metaData.enabled);
                    controller.update(ext).accept(null, e -> Log.w(TAG, "update failed " + ext.id, e));
                }
            }
            for (String[] e : EXTENSIONS) {
                if (ids.contains(e[0])) continue;
                String url = "https://addons.mozilla.org/firefox/downloads/latest/" + e[1] + "/latest.xpi";
                controller.install(url).accept(x -> {
                    Log.i(TAG, "extension newly installed: " + e[0]);
                    if (hasSession()) session.reload(); // reload once the blocker is active
                }, t -> Log.e(TAG, "install failed " + e[1], t));
            }
        }, t -> Log.e(TAG, "listing extensions failed", t));
    }

    private static void attachHelper(GeckoSession target) {
        if (helper == null || target == null || !target.isOpen()) return;
        target.getWebExtensionController().setMessageDelegate(helper, new WebExtension.MessageDelegate() {
            @Override
            public void onConnect(WebExtension.Port p) {
                port = p;
                p.setDelegate(new WebExtension.PortDelegate() {
                    @Override
                    public void onPortMessage(Object message, WebExtension.Port from) {
                        if (message instanceof JSONObject
                                && "log".equals(((JSONObject) message).optString("type"))) {
                            Log.i(TAG, "page: " + ((JSONObject) message).optString("text"));
                        }
                    }

                    @Override
                    public void onDisconnect(WebExtension.Port from) {
                        if (port == from) port = null;
                    }
                });
            }
        }, "markgram");
    }

    /** Debug aid: sends a JSON command to the page helper (results show up in the log). */
    static void debug(String json) {
        if (port == null) { Log.i(TAG, "debug: no helper port"); return; }
        try {
            port.postMessage(new JSONObject(json));
        } catch (Exception e) {
            Log.i(TAG, "debug failed: " + e);
        }
    }
}
