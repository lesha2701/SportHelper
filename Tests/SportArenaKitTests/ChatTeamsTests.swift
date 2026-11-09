import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let me = "aaaaaaaa-2222-4333-8444-555555555555"
private let other = "bbbbbbbb-2222-4333-8444-555555555555"

private func message(_ id: Int, from sender: String = me, body: String? = "Привет", deleted: Bool = false, attachment: String = "null") -> String {
    """
    {"id":\(id),"sender_id":"\(sender)","sender_name":"Анна","body":\(body.map { "\"\($0)\"" } ?? "null"),"attachment":\(attachment),
    "created_at":"2026-11-04T17:00:40.927565Z","deleted":\(deleted)}
    """
}

private func decodeMessage(_ text: String) throws -> ChatMessage { try APIClient.decoder.decode(ChatMessage.self, from: Data(text.utf8)) }

struct ChatModelTests {
    @Test func aMessageIsReadWithItsAttachment() throws {
        let photo = #"{"kind":"photo","file_id":"cccccccc-2222-4333-8444-555555555555","filename":"a.jpg","has_thumb":true}"#
        let parsed = try decodeMessage(message(7, body: nil, attachment: photo))
        #expect(parsed.id == 7 && parsed.body == nil)
        #expect(parsed.attachment?.kind == .photo && parsed.attachment?.hasThumb == true && parsed.attachment?.filename == "a.jpg")
    }

    @Test func aDeletedFlagMissingMeansNotDeleted() throws {
        let text = #"{"id":1,"sender_id":"\#(me)","sender_name":"А","body":"x","created_at":"2026-11-04T17:00:40Z"}"#
        #expect(try decodeMessage(text).deleted == false)
    }

    @Test func unreadIsLookedUpByTheIdOfTheBookingOrTheTeam() throws {
        let id = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
        let text = #"{"booking":{"11111111-2222-4333-8444-555555555555":3},"team":{"99999999-2222-4333-8444-555555555555":5},"total":8}"#
        let unread = try APIClient.decoder.decode(ChatUnread.self, from: Data(text.utf8))
        #expect(unread.forBooking(id) == 3 && unread.forTeam(id) == 0 && unread.total == 8)
        #expect(unread.forTeam(UUID(uuidString: "99999999-2222-4333-8444-555555555555")!) == 5)
    }
}

struct ChatThreadTests {
    private func msgs(_ ids: [Int]) throws -> [ChatMessage] { try ids.map { try decodeMessage(message($0)) } }

    @Test func messagesStayInTheOrderOfTheConversationWhateverTheArrivalOrder() throws {
        var thread = ChatThread()
        thread.merge(try msgs([5, 3, 4]))
        thread.merge(try msgs([6]))
        #expect(thread.messages.map(\.id) == [3, 4, 5, 6])
        #expect(thread.newestID == 6 && thread.oldestID == 3)
    }

    @Test func aMessageSeenTwiceIsShownOnce() throws {
        var thread = ChatThread()
        thread.merge(try msgs([1, 2]))
        thread.merge(try msgs([2, 3]))
        #expect(thread.messages.map(\.id) == [1, 2, 3])
    }

    @Test func aLaterCopyReplacesTheEarlierOne() throws {
        var thread = ChatThread()
        thread.merge(try msgs([1]))
        thread.merge([try decodeMessage(message(1, body: nil, deleted: true))])
        #expect(thread.messages.count == 1 && thread.messages[0].deleted)
    }

    @Test func anOlderPageGoesInFrontAndSaysIfThereIsMore() throws {
        var thread = ChatThread()
        thread.merge(try msgs([10, 11]))
        thread.prepend(ChatPage(items: try msgs([8, 9]), hasMoreBefore: true))
        #expect(thread.messages.map(\.id) == [8, 9, 10, 11] && thread.hasMoreBefore)
        thread.prepend(ChatPage(items: try msgs([7]), hasMoreBefore: false))
        #expect(thread.hasMoreBefore == false)
    }

    @Test func anEmptyRefreshChangesNothing() throws {
        var thread = ChatThread()
        thread.merge(try msgs([1]))
        thread.merge([])
        #expect(thread.messages.count == 1 && ChatThread().newestID == nil)
    }
}

struct ChatServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (ChatService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (ChatService(client: api), api)
    }
    private let chat = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!

    @Test func fetchingOnlyWhatIsNewAsksAfterTheLastMessage() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(#"{"items":[],"has_more_before":false}"#) }
        _ = try await service.messages(in: chat, after: 42)
        let url = try #require(seen.all.first?.url)
        #expect(url.path == "/api/chats/\(chat.uuidString.lowercased())/messages")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(query.contains(URLQueryItem(name: "after_id", value: "42")) && !query.contains { $0.name == "before_id" })
    }

    @Test func sendingCarriesTheClientKeySoARetryCannotDuplicate() async throws {
        let seen = RequestLog()
        let key = UUID()
        let (service, api) = make { request in seen.add(request); return json(message(9)) }
        await api.setCSRFToken("csrf-1")
        let sent = try await service.send("Привет", to: chat, clientKey: key)
        #expect(sent.id == 9)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-1")
        let body = try #require(request.bodyData)
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(object["body"] == "Привет" && object["client_key"] == key.uuidString.lowercased())
    }

    @Test func aPhotoIsSentAsMultipartWithTheKeyAndCaption() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(message(10)) }
        _ = try await service.sendMedia(Data([1, 2, 3]), filename: "p.jpg", mimeType: "image/jpeg", caption: "Смотри", to: chat, clientKey: UUID())
        let request = try #require(seen.all.first)
        #expect(request.url?.path.hasSuffix("/messages/media") == true)
        #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)
        let text = (String(data: try #require(request.bodyData), encoding: .utf8) ?? "")
        #expect(text.contains("name=\"client_key\"") && text.contains("name=\"body\"") && text.contains("Смотри"))
    }

    @Test func markingReadSendsTheLastSeenId() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return (204, [:], Data()) }
        try await service.markRead(upTo: 77, in: chat)
        let body = try #require(seen.all.first?.bodyData)
        #expect((String(data: body, encoding: .utf8) ?? "").contains("\"up_to_id\":77"))
    }

    @Test func aClosedChatSaysWhy() async throws {
        let text = #"{"id":"11111111-2222-4333-8444-555555555555","kind":"booking","title":"Сессия","can_send":false,"send_blocked_reason":"Тренировка завершена","can_moderate":false}"#
        let (service, _) = make { _ in json(text) }
        let conversation = try await service.conversation(forBooking: chat)
        #expect(conversation.canSend == false && conversation.sendBlockedReason == "Тренировка завершена")
    }
}

// MARK: teams

private func teamJSON(role: String? = "head_coach", level: String? = "amateur", status: String = "active") -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","name":"Спартак","description":null,"sport":"Футбол","age_category":"U15","level":\(level.map { "\"\($0)\"" } ?? "null"),
    "status":"\(status)","created_by":"\(me)","logo_file_id":null,"created_at":"2026-11-04T17:00:40Z","updated_at":"2026-11-04T17:00:40Z",
    "my_role":\(role.map { "\"\($0)\"" } ?? "null"),"members_count":12}
    """
}

struct TeamModelTests {
    private func team(_ text: String) throws -> Team { try APIClient.decoder.decode(Team.self, from: Data(text.utf8)) }

    @Test func aTeamKeepsItsTournamentsAndHomeVenueAndAnOldServerMeansNone() throws {
        let extra = "\"members_count\":12,\"tournaments\":[\"Лига\",\"Кубок\"],\"home_venue\":\"Арена\""
        let with = try team(teamJSON().replacingOccurrences(of: "\"members_count\":12", with: extra))
        #expect(with.tournaments == ["Лига", "Кубок"] && with.homeVenue == "Арена")
        let without = try team(teamJSON())
        #expect(without.tournaments.isEmpty && without.homeVenue == nil)
    }

    @Test func aTeamIsReadWithTheRoleOfThePerson() throws {
        let parsed = try team(teamJSON())
        #expect(parsed.name == "Спартак" && parsed.level == .amateur && parsed.myRole == .headCoach && parsed.membersCount == 12)
        #expect(parsed.canManage)
    }

    @Test(arguments: [("head_coach", true), ("assistant_coach", true), ("captain", false), ("player", false)])
    func onlyTheCoachingStaffManagesATeam(role: String, expected: Bool) throws {
        #expect(try team(teamJSON(role: role)).canManage == expected)
    }

    @Test func aRoleOrLevelWeDoNotKnowIsKeptButGivesNoRights() throws {
        let parsed = try team(teamJSON(role: "referee", level: "legend"))
        #expect(parsed.myRole == .other("referee") && parsed.level == nil && !parsed.canManage)
    }

    @Test func aTeamWithoutACoachIsRecognised() throws {
        #expect(try team(teamJSON(status: "without_coach")).isWithoutCoach)
    }

    @Test func everyRoleAndLevelHasRussianWording() {
        for level in TeamLevel.allCases { #expect(!level.title.isEmpty) }
        for role in [TeamRole.headCoach, .assistantCoach, .captain, .player] { #expect(role.title.range(of: "[А-Яа-я]", options: .regularExpression) != nil) }
    }
}

struct TeamInputTests {
    @Test func theTextIsTrimmedAndEmptyOptionalFieldsAreSentAsNull() throws {
        let input = try #require(TeamInput(name: "  Спартак ", sport: " Футбол", description: "   ", ageCategory: "", level: nil))
        let data = try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(input)) as? [String: Any])
        #expect(data["name"] as? String == "Спартак" && data["sport"] as? String == "Футбол")
        // Explicit nulls: otherwise clearing a field in the form would silently keep the old text on the server.
        #expect(data["description"] is NSNull && data["age_category"] is NSNull && data["level"] is NSNull)
    }

    @Test func tournamentsAreCleanedAndTheVenueIsSentAlongWithThem() throws {
        let input = try #require(TeamInput(name: "К", sport: "Ф", tournaments: [" Лига ", "", "Лига", "Кубок"], homeVenue: "  Арена "))
        #expect(input.tournaments == ["Лига", "Кубок"] && input.homeVenue == "Арена")
        let data = try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(input)) as? [String: Any])
        #expect(data["tournaments"] as? [String] == ["Лига", "Кубок"] && data["home_venue"] as? String == "Арена")
        let cleared = try #require(TeamInput(name: "К", sport: "Ф"))
        let sent = try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(cleared)) as? [String: Any])
        // «Remove them» is sent explicitly: the server keeps what a request leaves out.
        #expect((sent["tournaments"] as? [String])?.isEmpty == true && sent["home_venue"] is NSNull)
    }

    @Test func tooManyOrTooLongTournamentsAndAHugeVenueAreRefused() {
        #expect(TeamInput(name: "К", sport: "Ф", tournaments: (0..<21).map { "Т\($0)" }) == nil)
        #expect(TeamInput(name: "К", sport: "Ф", tournaments: [String(repeating: "я", count: 151)]) == nil)
        #expect(TeamInput(name: "К", sport: "Ф", homeVenue: String(repeating: "я", count: 201)) == nil)
    }

    @Test func aNameOrSportIsRequiredAndLimited() {
        #expect(TeamInput(name: "  ", sport: "Футбол") == nil)
        #expect(TeamInput(name: "Команда", sport: "") == nil)
        #expect(TeamInput(name: String(repeating: "я", count: 101), sport: "Футбол") == nil)
        #expect(TeamInput(name: String(repeating: "я", count: 100), sport: "Футбол") != nil)
        #expect(TeamInput(name: "К", sport: "Ф", description: String(repeating: "я", count: 1001)) == nil)
    }
}

struct InviteTokenTests {
    private let token = "AbCdEf0123456789_-AbCdEf0123456789"

    @Test func aTokenIsTakenOutOfTheLinkFromTheWebsite() {
        #expect(InviteToken.parse("https://sportarenaglobal.ru/?invite=\(token)") == token)
        #expect(InviteToken.parse("  https://sportarenaglobal.ru/?invite=\(token)\n") == token)
    }

    @Test func aBareTokenIsAccepted() {
        #expect(InviteToken.parse(token) == token)
    }

    @Test(arguments: ["", "   ", "коротко", "../../etc/passwd", "https://sportarenaglobal.ru/", "token with spaces and more words here", "abc"])
    func anythingThatIsNotATokenIsRefused(text: String) {
        #expect(InviteToken.parse(text) == nil)
    }

    @Test func aBadTokenNeverReachesTheNetwork() async {
        let seen = RequestLog()
        let api = APIClient(baseURL: host, session: MockServer.session { request in seen.add(request); return json("{}") })
        let service = TeamsService(client: api)
        do { _ = try await service.preview(token: "../../admin"); Issue.record("expected an error") } catch let error as APIError {
            #expect(error.code == "invalid_invite")
        } catch { Issue.record("wrong error") }
        #expect(seen.all.isEmpty)
    }
}

struct TeamsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TeamsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TeamsService(client: api), api)
    }
    private let team = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!

    @Test func creatingATeamPostsTheForm() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(teamJSON()) }
        let created = try await service.create(try #require(TeamInput(name: "Спартак", sport: "Футбол", level: .amateur)))
        #expect(created.name == "Спартак")
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/teams")
    }

    @Test func applyingWithAnInvitationReportsWaitingOrJoined() async throws {
        let token = "AbCdEf0123456789_-AbCdEf0123456789"
        let (service, _) = make { request in
            #expect(request.url?.path == "/api/invites/\(token)/apply")
            return json(#"{"status":"pending","team":"# + teamJSON(role: nil) + "}")
        }
        let result = try await service.apply(token: token)
        #expect(result.joined == false && result.team.name == "Спартак")
    }

    @Test func acceptingAndRejectingUseTheApplicationId() async throws {
        let seen = RequestLog()
        let application = UUID(uuidString: "99999999-2222-4333-8444-555555555555")!
        let (service, _) = make { request in seen.add(request); return (204, [:], Data()) }
        try await service.accept(application: application, in: team)
        try await service.reject(application: application, in: team)
        let paths = seen.all.compactMap { $0.url?.path }
        #expect(paths == [
            "/api/teams/\(team.uuidString.lowercased())/applications/\(application.uuidString.lowercased())/accept",
            "/api/teams/\(team.uuidString.lowercased())/applications/\(application.uuidString.lowercased())/reject"
        ])
    }

    @Test func aFullTeamComesBackAsTheServersMessage() async {
        let (service, _) = make { _ in json(#"{"error":{"code":"team_full","message":"В команде уже 50 человек."}}"#, status: 409) }
        do { try await service.accept(application: UUID(), in: team); Issue.record("expected an error") } catch let error as APIError {
            #expect(error.code == "team_full")
        } catch { Issue.record("wrong error") }
    }
}
