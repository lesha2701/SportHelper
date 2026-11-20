import SwiftUI

/// The mark next to the name of a trainer with the Pro status (the site's `ProBadge`): gold on dark ink in both appearances.
struct ProBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "crown.fill").font(.system(size: 9, weight: .bold))
            Text("PRO").font(.system(size: 10, weight: .heavy)).tracking(0.6)
        }
        .foregroundStyle(Color(red: 0.169, green: 0.102, blue: 0))
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(
            LinearGradient(colors: [Color(red: 0.973, green: 0.816, blue: 0.404), Color(red: 0.91, green: 0.588, blue: 0.165)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: Capsule()
        )
        .accessibilityLabel("Тренер Pro")
    }
}

/// A trainer's name with the Pro mark after it when he has the status.
struct CoachNameLabel: View {
    let name: String
    let isPro: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text(name)
            if isPro { ProBadge() }
        }
    }
}
