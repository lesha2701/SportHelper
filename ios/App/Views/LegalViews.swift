import SportArenaKit
import SwiftUI

/// The legal documents inside the app (the texts are carried in `App/Resources/Legal`, copied from the site by `scripts/sync-legal.sh`).
enum LegalLibrary {
    static func load(_ document: LegalDocument) -> LegalText? {
        let url = Bundle.main.url(forResource: document.key, withExtension: "json", subdirectory: "Legal")
            ?? Bundle.main.url(forResource: document.key, withExtension: "json")
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? LegalText.decode(data)
    }
}

/// «Правовые документы»: every document of the site, the ones for the person's role first.
struct LegalDocumentsView: View {
    let isCoach: Bool

    var body: some View {
        List {
            Section(sag: "Для всех") { rows([.terms, .privacy]) }
            if isCoach {
                Section(sag: "Для тренеров") { rows([.coachOffer, .serviceTerms, .consentCoach, .consentCoachDissemination]) }
                Section(sag: "Для спортсменов") { rows([.consentPlayer]) }
            } else {
                Section(sag: "Для спортсменов") { rows([.consentPlayer]) }
                Section(sag: "Для тренеров") { rows([.coachOffer, .serviceTerms, .consentCoach, .consentCoachDissemination]) }
            }
        }
        .sagScreen()
        .navigationTitle("Правовые документы")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func rows(_ documents: [LegalDocument]) -> some View {
        ForEach(documents) { document in
            NavigationLink {
                LegalReaderView(document: document)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(document.title)
                    Text(document.editionText).font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityIdentifier("legal.\(document.key)")
        }
    }
}

/// One document, read in place: headings, paragraphs with bold, italic and links, lists and tables.
struct LegalReaderView: View {
    let document: LegalDocument
    @State private var text: LegalText?
    @State private var missing = false

    var body: some View {
        Group {
            if let text {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(text.blocks.enumerated()), id: \.offset) { _, block in LegalBlockView(block: block) }
                        Link("Открыть на сайте", destination: URL(string: document.path, relativeTo: AppEnvironment.siteURL)?.absoluteURL ?? AppEnvironment.siteURL)
                            .font(.footnote).padding(.top, 8)
                            .accessibilityIdentifier("legal.openOnSite")
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityIdentifier("legal.text")
            } else if missing {
                ContentUnavailableView("Документ не найден", systemImage: "doc.questionmark",
                                       description: Text("Откройте его на сайте: \(document.path)"))
            } else {
                ProgressView()
            }
        }
        .sagScreen()
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            text = LegalLibrary.load(document)
            missing = text == nil
        }
    }
}

/// The sheet opened from a link at a check box of the sign-up form.
struct LegalPageSheet: View {
    @Environment(\.dismiss) private var dismiss
    let document: LegalDocument

    var body: some View {
        NavigationStack {
            LegalReaderView(document: document)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Закрыть") { dismiss() } } }
        }
    }
}

private struct LegalBlockView: View {
    let block: LegalText.Block

    var body: some View {
        switch block {
        case .heading(let level, let runs, let centered):
            Text(LegalAttributed.make(runs))
                .font(level == 1 ? Theme.display(22, relativeTo: .title2) : Theme.body(17, weight: .bold, relativeTo: .headline))
                .multilineTextAlignment(centered ? .center : .leading)
                .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
                .padding(.top, level == 1 ? 0 : 8)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let runs, let centered):
            Text(LegalAttributed.make(runs))
                .font(Theme.body(15))
                .multilineTextAlignment(centered ? .center : .leading)
                .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(index + 1)." : "•").font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
                        Text(LegalAttributed.make(item)).font(Theme.body(15))
                    }
                }
            }
        case .table(let rows):
            LegalTableView(rows: rows)
        }
    }
}

/// A table of a document as cards: a phone is too narrow for columns, so each row lists «column name — cell».
private struct LegalTableView: View {
    let rows: [[[[LegalText.Run]]]]

    var body: some View {
        let header = rows.first ?? []
        VStack(spacing: 8) {
            ForEach(Array(rows.dropFirst().enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                        VStack(alignment: .leading, spacing: 2) {
                            if column < header.count {
                                Text(header[column].map { $0.plainText }.joined(separator: " "))
                                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.textSecondary)
                            }
                            ForEach(Array(cell.enumerated()), id: \.offset) { _, paragraph in
                                Text(LegalAttributed.make(paragraph)).font(Theme.body(15))
                            }
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surfaceAlt, in: RoundedRectangle(cornerRadius: Theme.radius))
            }
        }
    }
}

enum LegalAttributed {
    static func make(_ runs: [LegalText.Run]) -> AttributedString {
        var result = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let href = run.href, let url = URL(string: href) { piece.link = url }
            result += piece
        }
        return result
    }
}
