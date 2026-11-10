import SportArenaKit
import SwiftUI

/// «Помощь»: the reference of the site's «Профиль → Помощь» — what each part of the app is for — with the welcome tour on top.
struct HelpView: View {
    let ownRole: String

    var body: some View {
        List {
            Section {
                Text(HelpGuide.summary).font(.subheadline).foregroundStyle(.secondary)
                WelcomeTourButton(ownRole: ownRole)
            }
            ForEach(HelpGuide.sections) { section in
                Section {
                    if let intro = section.intro {
                        Text(intro).font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(section.items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.label).font(Theme.body(15, weight: .semibold))
                            Text(item.text).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Label(section.title, systemImage: section.symbol)
                        .font(Theme.display(15, relativeTo: .subheadline)).textCase(.uppercase).foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("help.section.\(section.id)")
                }
            }
        }
        .sagScreen()
        .navigationTitle(HelpGuide.title)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("help.screen")
    }
}

/// The row of the profile that opens «Помощь».
struct HelpLink: View {
    let ownRole: String

    var body: some View {
        NavigationLink { HelpView(ownRole: ownRole) } label: { Label("Помощь", systemImage: "questionmark.circle") }
            .accessibilityIdentifier("profile.help")
    }
}
