import SwiftUI
import UIKit

/// The site's look: the same red in the light and the dark theme (`--color-primary` of the web app).
enum Theme {
    static let primary = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 1.0, green: 0.231, blue: 0.247, alpha: 1)    // #ff3b3f
            : UIColor(red: 0.851, green: 0.118, blue: 0.169, alpha: 1)  // #d91e2b
    })
}
