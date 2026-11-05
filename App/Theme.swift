import SwiftUI
import UIKit

/// The look of the site (`frontend/src/index.css`, the «MBA» design system): warm neutrals, one red, hairline borders, sharp corners, a
/// condensed display face for headings and a quiet text face. Light is the main theme, dark a full second one; every colour here is
/// the site's token of the same name, for both.
enum Theme {
    // MARK: colour

    private static func dynamic(light: UInt32, dark: UInt32, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let hex = isDark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255,
                alpha: isDark ? darkAlpha : 1
            )
        })
    }

    /// The screen's background (`--color-bg`).
    static let bg = dynamic(light: 0xfafafa, dark: 0x121214)
    /// Cards and rows (`--color-surface`).
    static let surface = dynamic(light: 0xffffff, dark: 0x1c1d20)
    /// What sits inside a card: fields, tiles (`--color-surface-alt`).
    static let surfaceAlt = dynamic(light: 0xf2f1ef, dark: 0x26272b)
    static let text = dynamic(light: 0x17181b, dark: 0xf2f1ef)
    static let textSecondary = dynamic(light: 0x5c5e66, dark: 0xa8a9ae)
    static let textTertiary = dynamic(light: 0x96979e, dark: 0x6e6f75)
    /// The hairline around a card (`--color-border`).
    static let border = dynamic(light: 0xe7e6e3, dark: 0xffffff, darkAlpha: 0.08)
    static let borderStrong = dynamic(light: 0xd6d4cf, dark: 0xffffff, darkAlpha: 0.14)

    /// The brand red (`--color-primary`): the main button, the active tab, the key numbers.
    static let primary = dynamic(light: 0xd91e2b, dark: 0xff3b3f)
    static let primaryPressed = dynamic(light: 0xb8121e, dark: 0xff5a5d)
    /// A light red wash (`--color-primary-glow`).
    static let primaryTint = dynamic(light: 0xfbeae9, dark: 0xff3b3f, darkAlpha: 0.16)
    /// The second accent, for quiet details (`--color-accent-blue`, in coral since the redesign).
    static let coral = dynamic(light: 0xf2a6a0, dark: 0xe8918c)

    static let success = dynamic(light: 0x1f9d5c, dark: 0x34c778)
    static let successTint = dynamic(light: 0xeafaf1, dark: 0x34c778, darkAlpha: 0.14)
    /// Errors are an orange-red, kept apart from the brand red (`--color-danger`).
    static let danger = dynamic(light: 0xe85d2a, dark: 0xff7a4d)
    static let dangerTint = dynamic(light: 0xfdf0e9, dark: 0xff7a4d, darkAlpha: 0.14)
    static let warning = dynamic(light: 0xb6790f, dark: 0xf5a623)
    static let warningTint = dynamic(light: 0xfdf3e0, dark: 0xf5a623, darkAlpha: 0.14)

    /// Feature panels (the hero of the first screen, a team's header): light in the light theme, graphite in the dark one.
    static let panel = dynamic(light: 0xf2f1ef, dark: 0x17181b)
    static let panelText = dynamic(light: 0x17181b, dark: 0xffffff)
    static let panelMuted = dynamic(light: 0x5c5e66, dark: 0xa3a3a6)
    static let panelBorder = dynamic(light: 0xe0deda, dark: 0xffffff, darkAlpha: 0.06)
    /// The kicker line over a panel's heading.
    static let panelKicker = dynamic(light: 0xd91e2b, dark: 0xe8918c)

    /// Always-dark blocks (the next event): graphite whatever the theme.
    static let graphite = Color(red: 0x1f / 255, green: 0x20 / 255, blue: 0x24 / 255)

    // MARK: shape

    static let radiusSmall: CGFloat = 4
    static let radius: CGFloat = 8
    static let radiusLarge: CGFloat = 12

    // MARK: type

    /// The display face (the site's Oswald): headings, tabs, buttons, big numbers. It is used when its font file is in the app; until
    /// then the system's condensed heavy face stands in for it, which has the same sports-poster look.
    static func display(_ size: CGFloat, weight: Font.Weight = .bold, relativeTo style: Font.TextStyle = .title) -> Font {
        if let name = displayFontName(for: weight) { return .custom(name, size: size, relativeTo: style) }
        return .system(size: size, weight: weight == .regular ? .semibold : .heavy).width(.condensed)
    }

    /// The text face (the site's Montserrat) when its font file is in the app, the system face otherwise.
    static func body(_ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        if let name = bodyFontName(for: weight) { return .custom(name, size: size, relativeTo: style) }
        return .system(size: size, weight: weight)
    }

    private static func displayFontName(for weight: Font.Weight) -> String? {
        let name = weight == .regular || weight == .medium ? "Oswald-Medium" : (weight == .semibold ? "Oswald-SemiBold" : "Oswald-Bold")
        return UIFont(name: name, size: 12) == nil ? nil : name
    }

    private static func bodyFontName(for weight: Font.Weight) -> String? {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Montserrat-Bold"
        case .semibold: name = "Montserrat-SemiBold"
        case .medium: name = "Montserrat-Medium"
        default: name = "Montserrat-Regular"
        }
        return UIFont(name: name, size: 12) == nil ? nil : name
    }

    /// The same display face for UIKit (the navigation and tab bars).
    static func displayUIFont(_ size: CGFloat, weight: UIFont.Weight = .bold) -> UIFont {
        let name = weight == .regular || weight == .medium ? "Oswald-Medium" : (weight == .semibold ? "Oswald-SemiBold" : "Oswald-Bold")
        if let font = UIFont(name: name, size: size) { return font }
        let base = UIFont.systemFont(ofSize: size, weight: .heavy)
        // the condensed width of the system face
        let descriptor = base.fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.width: -0.3, UIFontDescriptor.TraitKey.weight: UIFont.Weight.heavy],
        ])
        return UIFont(descriptor: descriptor, size: size)
    }
}
