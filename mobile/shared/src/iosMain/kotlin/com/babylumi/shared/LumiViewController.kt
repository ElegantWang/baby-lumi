@file:OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)

package com.babylumi.shared

import com.babylumi.shared.LumiWeb.Platform
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.readValue
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryOptionAllowBluetoothA2DP
import platform.AVFAudio.AVAudioSessionCategoryOptionDefaultToSpeaker
import platform.AVFAudio.AVAudioSessionCategoryPlayAndRecord
import platform.AVFAudio.AVAudioSessionModeDefault
import platform.CoreGraphics.CGRectZero
import platform.Foundation.NSBundle
import platform.Foundation.NSData
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSURLRequest
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Foundation.dataWithContentsOfFile
import platform.UIKit.UIApplication
import platform.UIKit.UIColor
import platform.UIKit.UIScrollViewContentInsetAdjustmentBehavior
import platform.UIKit.UIViewController
import platform.WebKit.WKAudiovisualMediaTypeNone
import platform.WebKit.WKFrameInfo
import platform.WebKit.WKMediaCaptureType
import platform.WebKit.WKNavigationAction
import platform.WebKit.WKNavigationActionPolicy
import platform.WebKit.WKNavigationDelegateProtocol
import platform.WebKit.WKPermissionDecision
import platform.WebKit.WKScriptMessage
import platform.WebKit.WKScriptMessageHandlerProtocol
import platform.WebKit.WKSecurityOrigin
import platform.WebKit.WKUIDelegateProtocol
import platform.WebKit.WKURLSchemeHandlerProtocol
import platform.WebKit.WKURLSchemeTaskProtocol
import platform.WebKit.WKUserContentController
import platform.WebKit.WKWebView
import platform.WebKit.WKWebViewConfiguration
import platform.darwin.NSObject
import kotlin.experimental.ExperimentalNativeApi

/** Called from Swift: the whole of Lumi as one view controller (hosted full screen by iosApp). */
fun MainViewController(): UIViewController = LumiViewController()

/**
 * Lumi on iOS: a full-screen WKWebView showing the web app that ships inside
 * the app bundle (www/), served through the private `lumi://app/` scheme.
 */
class LumiViewController : UIViewController(nibName = null, bundle = null) {

    private var webView: WKWebView? = null
    private val bridge = BridgeHandler(IosHost)
    private val schemeHandler = LumiSchemeHandler()
    private val messageHandler = LumiMessageHandler(bridge)
    private val uiDelegate = LumiUIDelegate()
    private val navigationDelegate = LumiNavigationDelegate { reload() }

    override fun loadView() {
        configureAudioSession()
        view = makeWebView()
    }

    override fun viewDidLoad() {
        super.viewDidLoad()
        reload()
    }

    @OptIn(ExperimentalNativeApi::class)
    private fun makeWebView(): WKWebView {
        val config = WKWebViewConfiguration().apply {
            setURLSchemeHandler(schemeHandler, forURLScheme = Platform.IOS.scheme)
            allowsInlineMediaPlayback = true
            mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone
            userContentController.addScriptMessageHandler(messageHandler, name = "lumi")
            preferences.textInteractionEnabled = false
        }
        val sky = UIColor(
            red = ((LumiWeb.BACKGROUND_ARGB shr 16) and 0xFF) / 255.0,
            green = ((LumiWeb.BACKGROUND_ARGB shr 8) and 0xFF) / 255.0,
            blue = (LumiWeb.BACKGROUND_ARGB and 0xFF) / 255.0,
            alpha = 1.0,
        )
        return WKWebView(frame = CGRectZero.readValue(), configuration = config).apply {
            setOpaque(false)
            backgroundColor = sky
            scrollView.backgroundColor = sky
            scrollView.scrollEnabled = false
            scrollView.bounces = false
            scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentBehavior.UIScrollViewContentInsetAdjustmentNever
            allowsLinkPreview = false
            allowsBackForwardNavigationGestures = false
            UIDelegate = uiDelegate
            navigationDelegate = this@LumiViewController.navigationDelegate
            // Safari's Web Inspector can attach to development builds only
            setInspectable(kotlin.native.Platform.isDebugBinary)
            webView = this
        }
    }

    private fun reload() {
        val url = NSURL.URLWithString(Platform.IOS.startUrl) ?: return
        webView?.loadRequest(NSURLRequest.requestWithURL(url))
    }

    /**
     * Speech and sound come out of the speaker even while the microphone is
     * listening (otherwise iOS would switch to the quiet earpiece on iPhones).
     */
    private fun configureAudioSession() {
        AVAudioSession.sharedInstance().setCategory(
            AVAudioSessionCategoryPlayAndRecord,
            mode = AVAudioSessionModeDefault,
            options = AVAudioSessionCategoryOptionDefaultToSpeaker or AVAudioSessionCategoryOptionAllowBluetoothA2DP,
            error = null,
        )
    }

    // Full screen (hidden status bar and home indicator, edge swipes deferred) is
    // handled by the Swift container in iosApp: UIKit declares those settings in a
    // way only Swift/Objective-C subclasses can override.

}

/** What the page may ask of the device, on iOS. */
private object IosHost : NativeHost {
    override fun setKeepScreenOn(on: Boolean) {
        UIApplication.sharedApplication.idleTimerDisabled = on
    }

    override fun log(message: String) {
        println("[Lumi] $message")
    }
}

/** Serves files from the app bundle's www/ folder for `lumi://app/...` requests. */
private class LumiSchemeHandler : NSObject(), WKURLSchemeHandlerProtocol {

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, startURLSchemeTask: WKURLSchemeTaskProtocol) {
        val task = startURLSchemeTask
        val url = task.request.URL ?: return
        val file = LumiWeb.resolve(url.path)
        val path = file?.let { NSBundle.mainBundle.resourcePath + "/" + LumiWeb.ASSET_ROOT + "/" + it }
        var data = path?.let { NSData.dataWithContentsOfFile(it) }
        if (file == null || data == null) {
            respond(task, url, 404, "text/plain", NSData())
            return
        }
        if (LumiWeb.needsBridge(file)) {
            val html = NSString.create(data = data, encoding = NSUTF8StringEncoding)?.toString().orEmpty()
            val injected = LumiWeb.injectBridge(html, Platform.IOS)
            data = NSString.create(string = injected).dataUsingEncoding(NSUTF8StringEncoding) ?: data
        }
        val mime = LumiWeb.mimeType(file)
        respond(task, url, 200, if (LumiWeb.isText(mime)) "$mime; charset=utf-8" else mime, data)
    }

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, stopURLSchemeTask: WKURLSchemeTaskProtocol) {
        // responses are sent in one go, so there is nothing left to cancel
    }

    private fun respond(task: WKURLSchemeTaskProtocol, url: NSURL, status: Long, contentType: String, data: NSData) {
        val headers = mapOf<Any?, Any?>(
            "Content-Type" to contentType,
            "Content-Length" to data.length.toString(),
            "Cache-Control" to "no-cache",
        )
        val response = NSHTTPURLResponse(uRL = url, statusCode = status, HTTPVersion = "HTTP/1.1", headerFields = headers)
        task.didReceiveResponse(response)
        task.didReceiveData(data)
        task.didFinish()
    }
}

/** Carries `window.webkit.messageHandlers.lumi.postMessage(...)` to the shared bridge. */
private class LumiMessageHandler(private val bridge: BridgeHandler) : NSObject(), WKScriptMessageHandlerProtocol {
    override fun userContentController(userContentController: WKUserContentController, didReceiveScriptMessage: WKScriptMessage) {
        bridge.onMessage(didReceiveScriptMessage.body as? String)
    }
}

/** Lets only Lumi's own page use the microphone, without WebKit's extra per-visit prompt. */
private class LumiUIDelegate : NSObject(), WKUIDelegateProtocol {
    override fun webView(
        webView: WKWebView,
        requestMediaCapturePermissionForOrigin: WKSecurityOrigin,
        initiatedByFrame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: (WKPermissionDecision) -> Unit,
    ) {
        val origin = requestMediaCapturePermissionForOrigin
        val ok = type == WKMediaCaptureType.WKMediaCaptureTypeMicrophone &&
            LumiWeb.allowMicrophone(origin.protocol, origin.host, Platform.IOS)
        // iOS still asks the person once (with the reason from Info.plist) before the first recording
        decisionHandler(if (ok) WKPermissionDecision.WKPermissionDecisionGrant else WKPermissionDecision.WKPermissionDecisionDeny)
    }
}

/** Keeps navigation inside Lumi, and restarts her if iOS reclaims the web process. */
private class LumiNavigationDelegate(private val restart: () -> Unit) : NSObject(), WKNavigationDelegateProtocol {
    override fun webView(
        webView: WKWebView,
        decidePolicyForNavigationAction: WKNavigationAction,
        decisionHandler: (WKNavigationActionPolicy) -> Unit,
    ) {
        val url = decidePolicyForNavigationAction.request.URL
        val ok = LumiWeb.allowNavigation(url?.scheme, url?.host, Platform.IOS)
        decisionHandler(if (ok) WKNavigationActionPolicy.WKNavigationActionPolicyAllow else WKNavigationActionPolicy.WKNavigationActionPolicyCancel)
    }

    override fun webViewWebContentProcessDidTerminate(webView: WKWebView) {
        restart()
    }
}
