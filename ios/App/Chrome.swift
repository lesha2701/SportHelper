import SwiftUI
import UIKit

/// The frame of the screens in the site's colours and type: the navigation bar and the tab bar (UIKit draws both).
@MainActor
enum Chrome {
    static func apply() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.bg)
        nav.shadowColor = UIColor(Theme.border)
        nav.titleTextAttributes = [.font: Theme.displayUIFont(19), .foregroundColor: UIColor(Theme.text)]
        nav.largeTitleTextAttributes = [.font: Theme.displayUIFont(32), .foregroundColor: UIColor(Theme.text)]
        let navBar = UINavigationBar.appearance()
        navBar.standardAppearance = nav
        navBar.scrollEdgeAppearance = nav
        navBar.compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(Theme.surface)
        tab.shadowColor = UIColor(Theme.border)
        let normal: [NSAttributedString.Key: Any] = [.font: Theme.displayUIFont(10.5), .foregroundColor: UIColor(Theme.textTertiary)]
        let selected: [NSAttributedString.Key: Any] = [.font: Theme.displayUIFont(10.5), .foregroundColor: UIColor(Theme.primary)]
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.normal.titleTextAttributes = normal
            item.selected.titleTextAttributes = selected
            item.normal.iconColor = UIColor(Theme.textTertiary)
            item.selected.iconColor = UIColor(Theme.primary)
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}
