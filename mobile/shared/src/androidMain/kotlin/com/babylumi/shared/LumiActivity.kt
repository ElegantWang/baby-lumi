package com.babylumi.shared

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import com.babylumi.shared.LumiWeb.Platform
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Lumi on Android: a full-screen WebView showing the web app that ships in the
 * APK (assets/www), served from Android's private https origin. The app module
 * only needs `class MainActivity : LumiActivity()`.
 */
open class LumiActivity : Activity(), NativeHost {

    private var web: WebView? = null
    private var pendingMicRequest: PermissionRequest? = null
    private val bridge = BridgeHandler(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= 33) {
            // Little hands swipe from the edges a lot: the back gesture never closes Lumi.
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { }
        }
        createWebView()
        hideSystemBars()
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun createWebView() {
        // Chrome's DevTools (chrome://inspect) can attach to development builds only
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        val view = WebView(this).apply {
            setBackgroundColor(LumiWeb.BACKGROUND_ARGB.toInt())
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            isHapticFeedbackEnabled = false
            isLongClickable = false
            setOnLongClickListener { true }
        }
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // settings and progress are kept in localStorage
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_NO_CACHE // files are local; a stale cache would only get in the way after updates
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = false // nothing to check, and it would try the network
        }
        view.addJavascriptInterface(AndroidTransport(), "LumiAndroid")
        view.webViewClient = LocalClient()
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handlePermission(request) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (request == pendingMicRequest) pendingMicRequest = null
            }
        }
        web = view
        setContentView(view)
        view.loadUrl(Platform.ANDROID.startUrl)
    }

    // ---- serving the bundled web app ----------------------------------------------------

    private inner class LocalClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            val url = request.url
            if (!LumiWeb.allowNavigation(url.scheme, url.host, Platform.ANDROID)) return status(403, "Forbidden") // no other origin, ever
            return serve(url.path)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            !LumiWeb.allowNavigation(request.url.scheme, request.url.host, Platform.ANDROID) // no links out

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // If the system reclaims the web renderer (e.g. low memory), start Lumi again
            // instead of letting the whole app crash.
            if (view == web) {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                web = null
                createWebView()
            }
            return true
        }
    }

    private fun serve(path: String?): WebResourceResponse {
        val file = LumiWeb.resolve(path) ?: return status(404, "Not Found")
        val mime = LumiWeb.mimeType(file)
        val headers = mapOf("Cache-Control" to "no-cache")
        return try {
            val stream = if (LumiWeb.needsBridge(file)) {
                val html = assets.open("${LumiWeb.ASSET_ROOT}/$file").use { it.readBytes().decodeToString() }
                ByteArrayInputStream(LumiWeb.injectBridge(html, Platform.ANDROID).encodeToByteArray())
            } else {
                assets.open("${LumiWeb.ASSET_ROOT}/$file")
            }
            WebResourceResponse(mime, if (LumiWeb.isText(mime)) "utf-8" else null, 200, "OK", headers, stream)
        } catch (e: IOException) {
            status(404, "Not Found")
        }
    }

    private fun status(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    // ---- the bridge -------------------------------------------------------------------------

    private inner class AndroidTransport {
        @JavascriptInterface
        fun post(message: String?) {
            runOnUiThread { bridge.onMessage(message) }
        }
    }

    override fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun log(message: String) {
        Log.i("Lumi", message)
    }

    // ---- microphone ("say it back") ----------------------------------------------------------

    private fun handlePermission(request: PermissionRequest) {
        val origin = request.origin
        val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
        if (!wantsMic || !LumiWeb.allowMicrophone(origin.scheme, origin.host, Platform.ANDROID)) {
            request.deny()
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pendingMicRequest?.deny()
            pendingMicRequest = request
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val request = pendingMicRequest ?: return
        if (requestCode != REQUEST_MIC) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny() // Lumi simply won't copy voices; everything else works
        }
        pendingMicRequest = null
        hideSystemBars()
    }

    // ---- full screen, all the time ------------------------------------------------------------

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Deprecated("Back does nothing (Android 12 and older use this path; see onCreate)")
    override fun onBackPressed() {
        // intentionally empty
    }

    // ---- lifecycle: no sound or drawing while Lumi is off screen ------------------------------

    override fun onResume() {
        super.onResume()
        web?.onResume()
        web?.resumeTimers()
        hideSystemBars()
    }

    override fun onPause() {
        web?.onPause()
        web?.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        web?.destroy()
        web = null
        super.onDestroy()
    }

    private companion object {
        const val REQUEST_MIC = 41
    }
}
