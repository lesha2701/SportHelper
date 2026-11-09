import Testing
@testable import SportArenaKit

@Suite("Помощь")
struct HelpGuideTests {
    @Test("every part of the app has a section, once, with a title and something to read")
    func sections() {
        let ids = HelpGuide.sections.map(\.id)
        #expect(Set(ids).count == ids.count)
        for expected in ["home", "teams", "library", "calendar", "coaches", "profile", "notifications", "search", "ai", "access"] {
            #expect(ids.contains(expected), "no section «\(expected)»")
        }
        for section in HelpGuide.sections {
            #expect(!section.title.isEmpty)
            #expect(section.intro != nil || !section.items.isEmpty, "«\(section.title)» is empty")
            let labels = section.items.map(\.label)
            #expect(Set(labels).count == labels.count, "«\(section.title)» repeats a label")
            for item in section.items {
                #expect(!item.text.isEmpty)
                #expect(item.text.first?.isUppercase == true, "«\(item.label)» starts with a lowercase letter")
            }
        }
    }

    @Test("nothing that exists only on the web is promised")
    func noWebOnlyWords() {
        let all = HelpGuide.sections.flatMap { [$0.title, $0.intro ?? ""] + $0.items.flatMap { [$0.label, $0.text] } }.joined(separator: " ")
        for word in ["Telegram", "Mini App", "Ctrl+K", "⌘K", "Просрочено"] {
            #expect(!all.contains(word), "«\(word)» is not in the app")
        }
    }

    @Test("the hint names the place the reference is found")
    func hint() {
        #expect(HelpGuide.reopenHint.hasSuffix("Помощь"))
    }
}
