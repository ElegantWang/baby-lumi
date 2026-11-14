package com.babylumi.shared

import com.babylumi.shared.LumiWeb.Platform
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LumiWebTest {
    @Test
    fun startPageIsServedForTheRoot() {
        assertEquals("index.html", LumiWeb.resolve("/"))
        assertEquals("index.html", LumiWeb.resolve(""))
        assertEquals("index.html", LumiWeb.resolve(null))
        assertEquals("index.html", LumiWeb.resolve("/index.html"))
    }

    @Test
    fun normalFilesResolveInsideTheBundle() {
        assertEquals("src/main.js", LumiWeb.resolve("/src/main.js"))
        assertEquals("assets/voice/zh/intro_1.m4a", LumiWeb.resolve("/assets/voice/zh/intro_1.m4a"))
        assertEquals("vendor/three/three.module.js", LumiWeb.resolve("vendor/three/three.module.js"))
    }

    @Test
    fun nothingOutsideTheBundleCanBeReached() {
        assertNull(LumiWeb.resolve("/../keystore.properties"))
        assertNull(LumiWeb.resolve("/src/../../secret"))
        assertNull(LumiWeb.resolve("/./index.html"))
        assertNull(LumiWeb.resolve("/src//main.js"))
        assertNull(LumiWeb.resolve("/src\\main.js"))
        assertNull(LumiWeb.resolve("/.assetsignore"))
        assertNull(LumiWeb.resolve("/assets/.hidden/file"))
    }

    @Test
    fun moduleScriptsAndAudioGetTheRightTypes() {
        assertEquals("text/javascript", LumiWeb.mimeType("src/main.js"))
        assertEquals("text/javascript", LumiWeb.mimeType("src/audio/recorder-worklet.js"))
        assertEquals("text/html", LumiWeb.mimeType("index.html"))
        assertEquals("application/json", LumiWeb.mimeType("assets/voice/languages.json"))
        assertEquals("application/manifest+json", LumiWeb.mimeType("manifest.webmanifest"))
        assertEquals("audio/mp4", LumiWeb.mimeType("assets/voice/en/hello_1.m4a"))
        assertEquals("image/png", LumiWeb.mimeType("icons/icon-192.PNG"))
        assertEquals("application/octet-stream", LumiWeb.mimeType("assets/lumi.bin"))
        assertEquals("application/octet-stream", LumiWeb.mimeType("noextension"))
        assertTrue(LumiWeb.isText("text/javascript"))
        assertTrue(LumiWeb.isText("application/json"))
        assertFalse(LumiWeb.isText("audio/mp4"))
    }

    @Test
    fun navigationNeverLeavesTheApp() {
        assertTrue(LumiWeb.allowNavigation("lumi", "app", Platform.IOS))
        assertTrue(LumiWeb.allowNavigation("https", "appassets.androidplatform.net", Platform.ANDROID))
        assertFalse(LumiWeb.allowNavigation("https", "example.com", Platform.ANDROID))
        assertFalse(LumiWeb.allowNavigation("http", "appassets.androidplatform.net", Platform.ANDROID))
        assertFalse(LumiWeb.allowNavigation("https", "app", Platform.IOS))
        assertFalse(LumiWeb.allowNavigation(null, null, Platform.IOS))
        assertFalse(LumiWeb.allowMicrophone("https", "evil.example", Platform.ANDROID))
    }

    @Test
    fun startUrlsMatchTheirOrigins() {
        assertEquals("https://appassets.androidplatform.net/index.html", Platform.ANDROID.startUrl)
        assertEquals("lumi://app/index.html", Platform.IOS.startUrl)
    }

    @Test
    fun bridgeIsInjectedBeforeAnyOtherScript() {
        val html = """<!doctype html><html lang="en"><head><meta charset="utf-8" /><script type="importmap">{}</script></head><body></body></html>"""
        for (platform in Platform.entries) {
            val out = LumiWeb.injectBridge(html, platform)
            val bridgeAt = out.indexOf("window.LumiNative")
            val importMapAt = out.indexOf("importmap")
            assertTrue(bridgeAt in 0 until importMapAt, "bridge comes first on $platform")
            assertTrue(out.contains(platform.transport))
            assertTrue(out.indexOf("<head>") < bridgeAt)
        }
        // a page without a <head> still gets it
        assertTrue(LumiWeb.injectBridge("<p>hi</p>", Platform.IOS).startsWith("<script>"))
        assertTrue(LumiWeb.needsBridge("index.html"))
        assertFalse(LumiWeb.needsBridge("src/main.js"))
    }
}

class BridgeHandlerTest {
    private class FakeHost : NativeHost {
        val screen = mutableListOf<Boolean>()
        val logs = mutableListOf<String>()
        override fun setKeepScreenOn(on: Boolean) {
            screen += on
        }
        override fun log(message: String) {
            logs += message
        }
    }

    @Test
    fun keepScreenOnMessagesReachTheDevice() {
        val host = FakeHost()
        val bridge = BridgeHandler(host)
        assertTrue(bridge.onMessage("keepScreenOn:1"))
        assertTrue(bridge.onMessage("keepScreenOn:0"))
        assertTrue(bridge.onMessage("keepScreenOn:true"))
        assertEquals(listOf(true, false, true), host.screen)
    }

    @Test
    fun diagnosticsAndErrorsAreLogged() {
        val host = FakeHost()
        val bridge = BridgeHandler(host)
        bridge.onMessage("diag:secure=true webgl2=true")
        bridge.onMessage("error:" + "x".repeat(2000))
        assertEquals("page ready: secure=true webgl2=true", host.logs[0])
        assertTrue(host.logs[1].length < 560, "long errors are trimmed")
    }

    @Test
    fun unknownOrEmptyMessagesAreIgnored() {
        val host = FakeHost()
        val bridge = BridgeHandler(host)
        assertFalse(bridge.onMessage(null))
        assertFalse(bridge.onMessage(""))
        assertFalse(bridge.onMessage("openUrl:https://example.com"))
        assertTrue(host.screen.isEmpty() && host.logs.isEmpty())
    }
}
