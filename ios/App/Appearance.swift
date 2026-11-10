import SwiftUI
import UIKit

/// Light, dark, or whatever the phone is set to. The site starts from the phone's setting and lets the person switch to the other theme
/// (`ThemeContext.tsx`); the app does the same and remembers the choice.
enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "Как в системе"
        case .light: "Светлая"
        case .dark: "Тёмная"
        }
    }

    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

@Observable @MainActor
final class AppearanceStore {
    private static let key = "sag.appearance"

    var choice: AppearanceChoice {
        didSet { UserDefaults.standard.set(choice.rawValue, forKey: Self.key) }
    }

    init() {
        choice = UserDefaults.standard.string(forKey: Self.key).flatMap(AppearanceChoice.init) ?? .system
    }

    /// The sun/moon button of the site: switches to the other theme than the one on screen now.
    func toggle(from current: ColorScheme) {
        choice = current == .dark ? .light : .dark
    }
}
