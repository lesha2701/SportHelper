import SwiftUI
import SportArenaKit

/// Shown instead of the whole app when the server no longer accepts this version (docs/mobile.md): the only way on is the store.
struct UpdateRequiredView: View {
    let notice: UpdateNotice
    @Environment(\.openURL) private var openURL

    var body: some View {
        ContentUnavailableView {
            Label("Нужно обновить приложение", systemImage: "arrow.down.app")
        } description: {
            Text(description)
        } actions: {
            if let url = notice.url {
                Button("Обновить") { openURL(url) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("update.open")
            }
        }
        .accessibilityIdentifier("update.required")
    }

    private var description: String {
        let base = "Эта версия больше не поддерживается: сервер изменился, и приложение не сможет с ним работать."
        let tail = notice.url == nil ? " Откройте App Store и обновите SportArena." : " Обновите её в App Store, чтобы продолжить."
        if let minimum = notice.minVersion { return base + tail + " Нужна версия \(minimum) или новее." }
        return base + tail
    }
}

/// A newer version exists but the old one still works: offered once, can be put off.
struct UpdateOfferBanner: View {
    let notice: UpdateNotice
    let dismiss: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.app").foregroundStyle(Theme.primary)
            Text("Вышла новая версия приложения")
                .font(.subheadline)
            Spacer(minLength: 8)
            if let url = notice.url {
                Button("Обновить") { openURL(url) }
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("update.offer.open")
            }
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .accessibilityLabel("Не сейчас")
                .accessibilityIdentifier("update.offer.dismiss")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Theme.surface)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("update.offer")
    }
}
