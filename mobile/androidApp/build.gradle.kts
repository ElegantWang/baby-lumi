// Lumi for Android. The app itself lives in the shared module (LumiActivity);
// this module adds the launcher entry, icons, theme, signing, and copies the
// web app from ../../app into the APK. Build a signed release with:
//   ./gradlew :androidApp:assembleRelease
import java.util.Properties

plugins {
    id("com.android.application")
}

// Signing details live in mobile/keystore.properties (never committed).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.babylumi.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.babylumi.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":shared"))
}

/** Copies the web app into the APK's assets (under www/), minus developer-only files. */
abstract class SyncWebApp : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val webApp: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun sync() {
        fs.sync {
            from(webApp)
            into(output.dir("www"))
            exclude("dev/**", "sw.js", "_headers", ".assetsignore", "**/.DS_Store")
        }
    }
}

val syncWebApp = tasks.register<SyncWebApp>("syncWebApp") {
    webApp.set(rootProject.layout.projectDirectory.dir("../app"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(syncWebApp, SyncWebApp::output)
    }
}
