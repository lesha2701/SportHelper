import SportArenaKit
import SwiftUI

/// «Знакомство с приложением»: the tour (`WelcomeGuide.steps`), one step on a page. Shown by itself to a new person; opened by hand
/// from the profile it has a cross instead of «Пропустить» and never touches the account.
struct WelcomeGuideView: View {
    /// Opened from the profile: closing it records nothing.
    var manual = false
    /// The role the person has, marked on the last page.
    var ownRole: String?
    let onFinish: () -> Void

    @State private var index = 0
    private let steps = WelcomeGuide.steps

    private var step: WelcomeStep { steps[index] }
    private var isLast: Bool { index == steps.count - 1 }

    var body: some View {
        VStack(spacing: 0) {
            topRow
            ScrollView {
                page
                    .id(step.id)
                    .transition(.opacity)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
            buttons
        }
        .background(Theme.bg.ignoresSafeArea())
        .gesture(DragGesture(minimumDistance: 40).onEnded { value in
            if value.translation.width < -40 { go(1) } else if value.translation.width > 40 { go(-1) }
        })
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("welcome.guide")
    }

    // MARK: pieces

    private var topRow: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                ForEach(steps.indices, id: \.self) { position in
                    Capsule()
                        .fill(position == index ? Theme.primary : position < index ? Theme.coral : Theme.borderStrong)
                        .frame(width: position == index ? 22 : 8, height: 8)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Шаг \(index + 1) из \(steps.count)")
            .accessibilityIdentifier("welcome.dots")
            Spacer()
            if manual {
                Button { onFinish() } label: { Image(systemName: "xmark").font(.body.weight(.semibold)).padding(8) }
                    .accessibilityLabel("Закрыть")
                    .accessibilityIdentifier("welcome.close")
            } else {
                Button("Пропустить") { onFinish() }
                    .font(Theme.body(15, weight: .semibold))
                    .accessibilityIdentifier("welcome.skip")
            }
        }
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
    }

    private var page: some View {
        VStack(alignment: .leading, spacing: 14) {
            visual.padding(.vertical, 12)
            if let kicker = step.kicker {
                Text(kicker).font(Theme.body(12, weight: .bold)).tracking(1).textCase(.uppercase).foregroundStyle(Theme.panelKicker)
            }
            Text(step.title).font(Theme.display(28)).foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("welcome.title")
            Text(step.lead).font(Theme.body(17, weight: .medium)).foregroundStyle(Theme.text)
            ForEach(step.points, id: \.self) { point in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success).padding(.top, 2).accessibilityHidden(true)
                    Text(point).font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
                }
            }
            if let extra = step.extra { Text(extra).font(Theme.body(15)).foregroundStyle(Theme.textSecondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var visual: some View {
        switch step.layout {
        case .tiles:
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: step.tiles.count % 3 == 0 ? 3 : 2), spacing: 10) {
                ForEach(step.tiles, id: \.label) { tile($0) }
            }
        case .flow:
            HStack(spacing: 4) {
                ForEach(Array(step.tiles.enumerated()), id: \.offset) { position, item in
                    tile(item, compact: true)
                    if position < step.tiles.count - 1 {
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.textTertiary).accessibilityHidden(true)
                    }
                }
            }
        case .roles:
            HStack(spacing: 10) {
                ForEach(Array(step.tiles.enumerated()), id: \.offset) { position, item in
                    VStack(spacing: 6) {
                        tile(item)
                        Text(ownsRole(position) ? "Ваша роль" : " ").font(Theme.body(12, weight: .bold)).foregroundStyle(Theme.success)
                    }
                    if position == 0 { Image(systemName: "arrow.left.arrow.right").foregroundStyle(Theme.textTertiary).accessibilityHidden(true) }
                }
            }
        }
    }

    /// The first tile of the last page is the player, the second the coach.
    private func ownsRole(_ position: Int) -> Bool { ownRole == (position == 0 ? "player" : "coach") }

    private func tile(_ item: WelcomeStep.Tile, compact: Bool = false) -> some View {
        VStack(spacing: 8) {
            Image(systemName: item.symbol).font(.system(size: compact ? 18 : 22, weight: .semibold)).foregroundStyle(Theme.primary)
                .frame(width: compact ? 38 : 44, height: compact ? 38 : 44)
                .background(Theme.primaryTint, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            Text(item.label).font(Theme.body(compact ? 11 : 13, weight: .semibold)).foregroundStyle(Theme.text)
                .multilineTextAlignment(.center).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, compact ? 10 : 14)
        .padding(.horizontal, compact ? 2 : 8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.border))
        .accessibilityElement(children: .combine)
    }

    private var buttons: some View {
        HStack(spacing: 12) {
            if index > 0 {
                Button("Назад") { go(-1) }.buttonStyle(.sagGhost).accessibilityIdentifier("welcome.back")
            }
            Button(primaryTitle) { if isLast { onFinish() } else { go(1) } }
                .buttonStyle(.sag)
                .accessibilityIdentifier("welcome.next")
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
    }

    private var primaryTitle: String {
        if index == 0 { return "Начать знакомство" }
        if isLast { return manual ? "Готово" : "Перейти в приложение" }
        return "Далее"
    }

    private func go(_ delta: Int) {
        let target = min(max(index + delta, 0), steps.count - 1)
        guard target != index else { return }
        withAnimation(.easeInOut(duration: 0.2)) { index = target }
    }
}

/// The row in the profile that opens the tour by hand. It reads like the rows around it: dark text, red icon.
struct WelcomeTourButton: View {
    let ownRole: String
    @State private var showing = false

    var body: some View {
        Button { showing = true } label: {
            Label { Text("Знакомство с приложением").foregroundStyle(Theme.text) } icon: { Image(systemName: "sparkles") }
        }
        .accessibilityIdentifier("profile.guide")
        .fullScreenCover(isPresented: $showing) { WelcomeGuideView(manual: true, ownRole: ownRole) { showing = false } }
    }
}
