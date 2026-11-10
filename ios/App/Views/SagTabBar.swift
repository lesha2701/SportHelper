import SwiftUI

/// The bottom bar of the site (`BottomNav.tsx`): flat, a hairline on top, the labels in small capitals of the display face, and a red
/// stripe over the active item. The system's own tab bar is hidden: on current iOS it floats as a glass pill, which the site does not.
struct SagTabBar: View {
    struct Item: Identifiable {
        let tab: AppTab
        let title: String
        let symbol: String
        var badge = 0
        var id: AppTab { tab }
    }

    let items: [Item]
    @Binding var selection: AppTab
    /// Called when the tab that is already selected is tapped again.
    var onReselect: (AppTab) -> Void = { _ in }
    /// The bar stays where it is when the keyboard comes: the keyboard covers it. (Taking it away for the time the keyboard is up made the
    /// screens under it lay themselves out again in the middle of the keyboard's animation, and the app never became idle for the UI tests.)
    var body: some View {
        bar.ignoresSafeArea(.keyboard)
    }

    private var bar: some View {
        HStack(spacing: 2) {
            ForEach(items) { item in
                let active = item.tab == selection
                Button { if active { onReselect(item.tab) } else { selection = item.tab } } label: {
                    VStack(spacing: 4) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: item.symbol).font(.system(size: 21, weight: active ? .semibold : .regular))
                            if item.badge > 0 {
                                Text("\(min(item.badge, 99))")
                                    .font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                                    .padding(.horizontal, 5).padding(.vertical, 1)
                                    .background(Theme.danger, in: Capsule())
                                    .offset(x: 12, y: -6)
                            }
                        }
                        Text(item.title)
                            .font(Theme.display(11, relativeTo: .caption2)).tracking(0.3).textCase(.uppercase)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .foregroundStyle(active ? Theme.primary : Theme.textTertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10).padding(.bottom, 6)
                    .overlay(alignment: .top) {
                        if active { Capsule().fill(Theme.primary).frame(width: 26, height: 3).offset(y: -1) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(TabPressStyle())
                .accessibilityLabel(item.title)
                .accessibilityValue(item.badge > 0 ? "Непрочитанных: \(item.badge)" : "")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(.horizontal, 6)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mainTabBar")
    }
}

/// A press shrinks the item a little, as the site's `:active { scale(0.94) }`.
private struct TabPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.94 : 1).animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
