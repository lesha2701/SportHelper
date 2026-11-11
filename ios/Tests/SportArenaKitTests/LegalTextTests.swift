import Foundation
import Testing
@testable import SportArenaKit

/// The app carries copies of the site's legal texts. These tests read the real files of the repository, so an edition that is changed
/// on the site but not copied into the app (`scripts/sync-legal.sh`) stops the build instead of reaching a reader.
struct LegalTextTests {
    private static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    private static let site = root.deletingLastPathComponent().appendingPathComponent("frontend/src/legal/data")
    private static let bundled = root.appendingPathComponent("App/Resources/Legal")

    private func data(_ directory: URL, _ document: LegalDocument) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(document.key + ".json"))
    }

    @Test func everyDocumentOfTheAppReadsAndIsInTheEditionTheSignUpFormReports() throws {
        for document in LegalDocument.allCases {
            let text = try LegalText.decode(try data(Self.bundled, document))
            #expect(text.key == document.key, "\(document.key)")
            #expect(text.version == document.version, "\(document.key): the copy is in another edition than the sign-up form reports")
            #expect(!text.title.isEmpty && text.blocks.count > 5, "\(document.key)")
        }
    }

    @Test func theCopyInTheAppIsTheSitesFileExactly() throws {
        for document in LegalDocument.allCases {
            #expect(try data(Self.bundled, document) == (try data(Self.site, document)), "\(document.key): run ios/scripts/sync-legal.sh")
        }
        let copied = try FileManager.default.contentsOfDirectory(atPath: Self.bundled.path).filter { $0.hasSuffix(".json") }
        #expect(copied.count == LegalDocument.allCases.count)
    }

    @Test func blocksKeepTheirKindFormattingAndLinks() throws {
        let json = """
        {"key":"x","title":"T","version":"2026-10-20","blocks":[
         {"type":"h1","runs":[{"t":"Заголовок"}],"center":true},
         {"type":"p","runs":[{"t":"Слово ","b":true},{"t":"курсив","i":true},{"t":" и ссылка","href":"mailto:a@b.ru"}]},
         {"type":"p","runs":[{"t":"по центру"}],"align":"center"},
         {"type":"ol","items":[[{"t":"один"}],[{"t":"два"}]]},
         {"type":"table","rows":[[[[{"t":"Цель"}]],[[{"t":"Данные"}]]],[[[{"t":"Вход"}]],[[{"t":"почта"},{"t":"!"}],[{"t":"телефон"}]]]]}]}
        """
        let text = try LegalText.decode(Data(json.utf8))
        #expect(text.blocks.count == 5)
        guard case .heading(let level, let h, let centered) = text.blocks[0] else { Issue.record("heading"); return }
        #expect(level == 1 && centered && h.plainText == "Заголовок")
        guard case .paragraph(let runs, let center2) = text.blocks[1] else { Issue.record("paragraph"); return }
        #expect(!center2 && runs[0].bold && runs[1].italic && runs[2].href == "mailto:a@b.ru" && runs.plainText == "Слово курсив и ссылка")
        guard case .paragraph(_, let center3) = text.blocks[2] else { Issue.record("paragraph 2"); return }
        #expect(center3)
        guard case .list(let ordered, let items) = text.blocks[3] else { Issue.record("list"); return }
        #expect(ordered && items.map(\.plainText) == ["один", "два"])
        guard case .table(let rows) = text.blocks[4] else { Issue.record("table"); return }
        #expect(rows.count == 2 && rows[1][1].count == 2 && rows[1][1][0].plainText == "почта!")
    }

    @Test func anUnknownBlockIsAnErrorNotASilentGap() {
        let json = #"{"key":"x","title":"T","version":"2026-10-20","blocks":[{"type":"video","runs":[]}]}"#
        #expect(throws: DecodingError.self) { _ = try LegalText.decode(Data(json.utf8)) }
    }

    @Test func theEditionIsWrittenTheWayTheDocumentsDoIt() {
        #expect(LegalDocument.terms.editionText == "Редакция от 20.10.2026")
    }
}
