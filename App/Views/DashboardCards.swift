import SportArenaKit
import SwiftUI

/// A titled card on a screen of numbers (the home, the statistics).
struct DashboardCard<Content: View>: View {
    let title: String
    var trailing: AnyView?
    @ViewBuilder let content: Content

    init(_ title: String, trailing: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.trailing = trailing
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(Theme.display(18, relativeTo: .headline)).tracking(0.4).textCase(.uppercase).foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                trailing
            }
            content
        }
        .sagCard(padding: 16, radius: 16)
    }
}

/// Big numbers in two columns; the first one is the accent.
struct StatTiles: View {
    let items: [(String, String)]

    init(_ items: [(String, String)]) { self.items = items }

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                StatTile(value: item.0, label: item.1, emphasized: index == 0)
                    .accessibilityIdentifier("stats.tile")
            }
        }
    }
}

/// «Label — value» in a card.
struct StatRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title).font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.text)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A button that asks the server for a written analysis (it takes a while) and shows the text under it.
struct AnalysisCard: View {
    let title: String
    let hint: String
    let button: String
    let identifier: String
    let run: () async -> Result<String, APIError>

    @State private var loading = false
    @State private var text: String?
    @State private var error: String?

    var body: some View {
        DashboardCard(title, trailing: AnyView(Image(systemName: "sparkles").foregroundStyle(Theme.primary))) {
            if text == nil { Text(hint).font(.subheadline).foregroundStyle(.secondary) }
            if let text { Text(text).font(.subheadline).textSelection(.enabled).accessibilityIdentifier("\(identifier).text") }
            if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("\(identifier).error") }
            Button {
                Task { await ask() }
            } label: {
                if loading {
                    HStack { ProgressView(); Text("Формирую…") }.frame(maxWidth: .infinity)
                } else {
                    Text(text == nil ? button : "Обновить").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.sag)
            .disabled(loading)
            .accessibilityIdentifier(identifier)
        }
    }

    private func ask() async {
        loading = true
        error = nil
        defer { loading = false }
        switch await run() {
        case .success(let answer): text = answer
        case .failure(let failure): error = failure.message
        }
    }
}
