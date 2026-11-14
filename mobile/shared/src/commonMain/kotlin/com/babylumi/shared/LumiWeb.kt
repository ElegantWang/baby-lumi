package com.babylumi.shared

/**
 * Everything about hosting Lumi's web app that is the same on Android and iOS.
 *
 * Both apps carry the web app inside them (under `www/`) and serve it from a
 * private origin of their own, so the page is a secure context (needed for the
 * microphone and ES modules) and nothing is ever fetched from the internet:
 *   Android  https://appassets.androidplatform.net/   (reserved by Android for exactly this)
 *   iOS      lumi://app/                               (a custom scheme the app handles itself)
 */
object LumiWeb {
    const val ASSET_ROOT = "www"
    const val INDEX = "index.html"

    /** The sky colour the web app fades in from: shown behind the page while it loads. */
    const val BACKGROUND_ARGB: Long = 0xFFBFE3F2

    private val MIME = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "webmanifest" to "application/manifest+json",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "svg" to "image/svg+xml",
        "m4a" to "audio/mp4",
        "mp3" to "audio/mpeg",
        "wav" to "audio/wav",
        "bin" to "application/octet-stream",
    )

    /**
     * Turns the path of a request into a file inside [ASSET_ROOT], or null when
     * it must not be served (it tries to climb out, or is otherwise malformed).
     * "/" and "" mean the start page. Query strings must already be removed.
     */
    fun resolve(path: String?): String? {
        val p = path.orEmpty().trimStart('/')
        if (p.isEmpty()) return INDEX
        if (p.contains('\\') || p.contains('\u0000')) return null
        val parts = p.split('/')
        if (parts.any { it == ".." || it == "." || it.isEmpty() }) return null
        if (parts.any { it.startsWith(".") }) return null // no hidden files
        return p
    }

    /** Content type for a file name. Module scripts are only run with a JavaScript type. */
    fun mimeType(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return MIME[ext] ?: "application/octet-stream"
    }

    /** Text types are sent with a UTF-8 charset. */
    fun isText(mime: String): Boolean = mime.startsWith("text/") || mime.endsWith("json")

    /** The start page gets the native bridge injected, so it exists before Lumi's own scripts run. */
    fun needsBridge(path: String): Boolean = path == INDEX

    /**
     * Navigation stays inside the app: only the app's own origin may be shown,
     * and there are no links out (a child can't wander off to the web).
     */
    fun allowNavigation(scheme: String?, host: String?, platform: Platform): Boolean =
        scheme.equals(platform.scheme, ignoreCase = true) && host.equals(platform.host, ignoreCase = true)

    /** Same rule for microphone requests: only Lumi's own page may ask. */
    fun allowMicrophone(scheme: String?, host: String?, platform: Platform): Boolean =
        allowNavigation(scheme, host, platform)

    /** Inserts the bridge script at the top of `<head>`, ahead of every other script. */
    fun injectBridge(html: String, platform: Platform): String {
        val tag = "<script>${Bridge.script(platform)}</script>"
        val head = Regex("<head[^>]*>", RegexOption.IGNORE_CASE).find(html)
        return if (head != null) {
            html.substring(0, head.range.last + 1) + "\n    " + tag + html.substring(head.range.last + 1)
        } else {
            tag + html
        }
    }

    enum class Platform(val scheme: String, val host: String, val label: String, val transport: String) {
        ANDROID("https", "appassets.androidplatform.net", "android", "window.LumiAndroid.post(m)"),
        IOS("lumi", "app", "ios", "window.webkit.messageHandlers.lumi.postMessage(m)");

        val startUrl: String get() = "$scheme://$host/$INDEX"
    }
}
