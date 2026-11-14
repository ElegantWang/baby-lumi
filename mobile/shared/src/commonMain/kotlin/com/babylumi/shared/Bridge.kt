package com.babylumi.shared

/** What the page may ask of the device. Implemented once per platform. */
interface NativeHost {
    /** Keep the screen awake while Lumi is up and playing; let it sleep while she naps. */
    fun setKeepScreenOn(on: Boolean)

    /** Developer log (Logcat on Android, the device console on iOS). */
    fun log(message: String)
}

/**
 * The small, string-based channel between Lumi's web app and the native app.
 *
 * The page sees `window.LumiNative` (the web app already checks for it); each
 * call becomes a short text message such as `keepScreenOn:1`, carried by the
 * platform's own transport and handled here, in shared code.
 */
object Bridge {
    /** JavaScript injected at the top of the start page. */
    fun script(platform: LumiWeb.Platform): String = """
(function () {
  var post = function (m) { try { ${platform.transport}; } catch (e) {} };
  window.LumiNative = {
    platform: '${platform.label}',
    keepScreenOn: function (on) { post('keepScreenOn:' + (on ? 1 : 0)); }
  };
  window.addEventListener('error', function (e) {
    post('error:' + (e.message || 'error') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; post('error:unhandled ' + (r && (r.message || r)));
  });
  window.addEventListener('load', function () {
    var c = document.createElement('canvas'), gl = c.getContext('webgl2');
    var lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    post('diag:secure=' + window.isSecureContext + ' webgl2=' + !!gl +
      ' mic=' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) +
      ' worklet=' + (typeof AudioWorkletNode !== 'undefined') + ' lang=' + navigator.language);
  });
})();
""".trim()

    /** Message names the page may send. */
    const val KEEP_SCREEN_ON = "keepScreenOn"
    const val DIAG = "diag"
    const val ERROR = "error"
}

/** Turns bridge messages into calls on the platform's [NativeHost]. */
class BridgeHandler(private val host: NativeHost) {
    /** @return true if the message was understood */
    fun onMessage(message: String?): Boolean {
        if (message.isNullOrEmpty()) return false
        val name = message.substringBefore(':')
        val arg = message.substringAfter(':', "")
        return when (name) {
            Bridge.KEEP_SCREEN_ON -> {
                host.setKeepScreenOn(arg == "1" || arg == "true")
                true
            }
            Bridge.DIAG -> {
                host.log("page ready: $arg")
                true
            }
            Bridge.ERROR -> {
                host.log("page error: ${arg.take(500)}")
                true
            }
            else -> false
        }
    }
}
