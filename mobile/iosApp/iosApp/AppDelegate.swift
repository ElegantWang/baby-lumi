import UIKit
import Shared

// Lumi for iPhone and iPad. Almost everything lives in the shared Kotlin
// module (see shared/src/iosMain); this file only opens a window for it.

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        true
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = LumiHostViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

/// Holds Lumi (built in Kotlin) and keeps the screen hers alone: no status bar,
/// no home indicator, and edge swipes need a second try, so little fingers
/// don't wander off to Control Center or the home screen.
final class LumiHostViewController: UIViewController {
    private let lumi = LumiViewControllerKt.MainViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground")
        addChild(lumi)
        lumi.view.frame = view.bounds
        lumi.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(lumi.view)
        lumi.didMove(toParent: self)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
}
