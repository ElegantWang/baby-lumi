// Lumi for phones and tablets, built with Kotlin Multiplatform:
//   shared/      Kotlin shared by both apps (hosting rules, the native bridge),
//                plus each platform's web-view host (androidMain / iosMain)
//   androidApp/  the Android app (APK)
//   iosApp/      the iOS app (open iosApp/iosApp.xcodeproj in Xcode)
// Both carry the web app from ../app inside them, copied in at build time.
plugins {
    kotlin("multiplatform") version "2.4.21" apply false
    id("com.android.application") version "9.5.1" apply false
    id("com.android.kotlin.multiplatform.library") version "9.5.1" apply false
}
