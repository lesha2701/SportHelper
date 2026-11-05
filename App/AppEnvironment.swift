import Foundation
import SportArenaKit

/// Where the app talks to: the address comes from the build configuration (`API_BASE_URL` in project.yml), so a Debug
/// build uses the server on this Mac and a Release build the real site. Nothing secret lives here.
struct AppEnvironment {
    let baseURL: URL
    /// The site itself: the legal documents are published there (a Debug build's server has no pages).
    static let siteURL = URL(string: "https://sportarenaglobal.ru")!

    static var current: AppEnvironment {
        let text = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String ?? "https://sportarenaglobal.ru"
        return AppEnvironment(baseURL: URL(string: text) ?? URL(string: "https://sportarenaglobal.ru")!)
    }
}
