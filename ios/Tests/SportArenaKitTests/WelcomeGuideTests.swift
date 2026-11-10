import Foundation
import Testing
@testable import SportArenaKit

struct WelcomeGuideTests {
    @Test func everyStepHasItsWordsAndTheIdsAreDistinct() {
        let steps = WelcomeGuide.steps
        #expect(steps.count >= 8)
        #expect(Set(steps.map(\.id)).count == steps.count)
        for step in steps {
            #expect(!step.title.isEmpty && !step.lead.isEmpty, "step \(step.id) is missing words")
            #expect(!step.tiles.isEmpty, "step \(step.id) has nothing to draw")
        }
    }

    @Test func theTourStartsWithAWelcomeAndEndsWithTheRolesAndHowToComeBack() throws {
        #expect(WelcomeGuide.steps.first?.id == "welcome")
        let last = try #require(WelcomeGuide.steps.last)
        #expect(last.id == "roles" && last.layout == .roles && last.tiles.count == 2)
        #expect(last.extra?.contains(WelcomeGuide.reopenHint) == true)
    }

    @Test func nothingMentionsWhatOnlyTheWebHas() {
        let words = WelcomeGuide.steps.flatMap { [$0.title, $0.lead, $0.extra ?? ""] + $0.points }.joined(separator: " ")
        #expect(!words.contains("⌘") && !words.contains("в бота"))
    }

    @Test func finishingTheTourIsPostedWithoutABody() async throws {
        let seen = RequestLog()
        let session = MockServer.session { request in seen.add(request); return json(userJSON) }
        let api = APIClient(baseURL: URL(string: "https://sportarenaglobal.ru")!, session: session)
        try await AuthService(client: api).completeOnboarding()
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/users/me/onboarding/complete")
    }
}
