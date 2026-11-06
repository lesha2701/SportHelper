import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

private func item(_ category: String, read: Bool = false) -> String {
    let readAt = read ? "\"2026-11-05T11:00:00.250Z\"" : "null"
    return #"{"id":"\#(one)","category":"\#(category)","title":"Заголовок","body":"Текст","entity_type":"x","entity_id":"\#(one)","#
        + #""send_at":"2026-11-05T10:00:00Z","read_at":\#(readAt)}"#
}

struct NotificationsTests {
    private func make(_ handler: @escaping MockServer.Handler) -> NotificationsService {
        NotificationsService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func theFeedIsReadWithItsReadState() async throws {
        let service = make { _ in json("[\(item("new_task")),\(item("chat_team", read: true))]") }
        let items = try await service.list()
        #expect(items.count == 2)
        #expect(items[0].category == .newTask && items[0].isUnread && items[0].title == "Заголовок")
        #expect(!items[1].isUnread)
    }

    @Test func aCategoryTheAppDoesNotKnowIsStillShown() async throws {
        let service = make { _ in json("[\(item("brand_new_kind"))]") }
        let items = try await service.list()
        #expect(items.first?.category == .other && items.first?.target == NotificationTarget.none)
    }

    @Test func eachCategoryLeadsWhereTheSiteSendsIt() {
        let id = UUID(uuidString: one)!
        func target(_ category: NotificationCategory) -> NotificationTarget {
            NotificationItem(id: id, category: category, title: "", body: "", entityId: id, sendAt: Date()).target
        }
        #expect(target(.trainingReminder) == .training(id) && target(.newTraining) == .training(id))
        #expect(target(.newMatch) == .match(id))
        #expect(target(.taskDeadline) == .task(id) && target(.newTask) == .task(id))
        #expect(target(.bookingRequested) == .incomingBookings)
        #expect([.bookingDecided, .paymentUpdate].allSatisfy { target($0) == .myBookings })
        #expect(target(.reviewRequested) == .reviewBooking(id))
        #expect(target(.chatBooking) == .bookingChat(id) && target(.chatTeam) == .teamChat(id))
        #expect(target(.trainingNudge) == .newPersonalTraining)
        #expect([.earningUpdate, .withdrawalUpdate].allSatisfy { target($0) == NotificationTarget.finance })
        #expect(target(.financeAdmin) == NotificationTarget.none)
    }

    @Test func markingOneReadAsksTheServerForThatOne() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(item("new_task", read: true)) }
        try await service.markRead(UUID(uuidString: one)!)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/notifications/\(one)/read")
    }

    @Test func markingAllReadAcceptsAnEmptyAnswer() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("", status: 204) }
        try await service.markAllRead()
        #expect(seen.all.first?.url?.path == "/api/notifications/read-all")
    }

    @Test func readingAnItemKeepsAnEarlierReadTime() {
        let id = UUID(uuidString: one)!
        let early = Date(timeIntervalSince1970: 100)
        let marked = NotificationItem(id: id, category: .newTask, title: "", body: "", entityId: id, sendAt: early, readAt: early)
        #expect(marked.read(at: Date()).readAt == early)
        #expect(NotificationItem(id: id, category: .newTask, title: "", body: "", entityId: id, sendAt: early).read(at: early).isUnread == false)
    }

    @Test func theSwitchesComeAsTheServerListsThem() async throws {
        let service = make { _ in
            json(#"[{"category":"training_reminder","enabled":true},{"category":"chat_team","enabled":false},{"category":"later_kind","enabled":true}]"#)
        }
        let preferences = try await service.preferences()
        #expect(preferences.map(\.category) == [.trainingReminder, .chatTeam, .other])
        #expect(preferences[1].enabled == false)
    }

    @Test func changingOneSwitchSendsOnlyThatOne() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"[{"category":"chat_team","enabled":false}]"#) }
        let now = try await service.set(.chatTeam, enabled: false)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/notifications/preferences")
        let list = try #require(request.bodyJSON?["preferences"] as? [[String: Any]])
        #expect(list.count == 1 && list[0]["category"] as? String == "chat_team" && list[0]["enabled"] as? Bool == false)
        #expect(now.first?.enabled == false)
    }

    @Test func onlyTheNonTransactionalCategoriesHaveSwitches() {
        #expect(NotificationCategory.switchable.count == 11)
        #expect(!NotificationCategory.switchable.contains(.paymentUpdate))
        #expect(NotificationCategory.allCases.allSatisfy { !$0.settingsTitle.isEmpty && !$0.symbol.isEmpty })
    }
}
