import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

struct PasswordChangeDraftTests {
    @Test func everythingMustBeFilledAndTheNewPasswordLongEnoughAndDifferent() {
        #expect(PasswordChangeDraft().fieldErrors().keys.count == 2, "empty current and a too short new one; the empty confirm equals the empty new")
        let ok = PasswordChangeDraft(current: "old password here", new: "a brand new passphrase", confirm: "a brand new passphrase")
        #expect(ok.isReady)
        #expect(PasswordChangeDraft(current: "x", new: "short", confirm: "short").fieldErrors()[.new]?.contains("минимум 12") == true)
        let same = PasswordChangeDraft(current: "same password 12", new: "same password 12", confirm: "same password 12")
        #expect(same.fieldErrors()[.new] == "Новый пароль должен отличаться от текущего.")
        let mismatch = PasswordChangeDraft(current: "x", new: "a brand new passphrase", confirm: "another passphrase")
        #expect(mismatch.fieldErrors()[.confirm] == "Пароли не совпадают.")
    }

    @Test func serverFieldsMapToFormFields() {
        #expect(PasswordChangeDraft.field(forServer: "password") == .current)
        #expect(PasswordChangeDraft.field(forServer: "new_password") == .new)
        #expect(PasswordChangeDraft.field(forServer: "new_password_confirm") == .confirm)
        #expect(PasswordChangeDraft.field(forServer: nil) == nil && PasswordChangeDraft.field(forServer: "other") == nil)
    }
}

struct EmailChangeDraftTests {
    @Test func theAddressMustLookLikeOneAndDifferFromTheCurrentOne() {
        #expect(EmailChangeDraft(newEmail: "nope", password: "x").fieldErrors()[.email] != nil)
        #expect(EmailChangeDraft(newEmail: "Me@Example.com", password: "x").fieldErrors(currentEmail: "me@example.com")[.email] == "Это уже ваш текущий адрес.")
        #expect(EmailChangeDraft(newEmail: "new@example.com", password: "").fieldErrors()[.password] == "Введите пароль для подтверждения.")
        #expect(EmailChangeDraft(newEmail: " new@example.com ", password: "x").isReady(currentEmail: "old@example.com"))
        #expect(EmailChangeDraft(newEmail: " new@example.com ").tidyEmail == "new@example.com")
    }

    @Test func serverFieldsMapToFormFields() {
        #expect(EmailChangeDraft.field(forServer: "new_email") == .email && EmailChangeDraft.field(forServer: "password") == .password)
    }
}

struct AccountServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> AccountService {
        AccountService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    @Test func thePasswordGoesWithItsConfirmation() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"message":"Пароль изменён. На других устройствах вы вышли из аккаунта."}"#) }
        let message = try await service.changePassword(PasswordChangeDraft(current: "old", new: "brand new passphrase", confirm: "brand new passphrase"))
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/auth/change-password")
        let expected = ["current_password": "old", "new_password": "brand new passphrase", "new_password_confirm": "brand new passphrase"]
        #expect(request.bodyJSON as? [String: String] == expected)
        #expect(message.hasPrefix("Пароль изменён"))
    }

    @Test func aWrongPasswordKeepsTheServersFieldAndCode() async {
        let service = make { _ in json(#"{"error":{"code":"invalid_password","message":"Неверный текущий пароль.","field":"password"}}"#, status: 403) }
        do {
            try await service.changePassword(PasswordChangeDraft(current: "x", new: "brand new passphrase", confirm: "brand new passphrase"))
            Issue.record("a wrong password went through")
        } catch let error as APIError {
            #expect(error.code == "invalid_password" && error.field == "password" && error.status == 403)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test func theNewEmailIsSentTrimmedWithThePassword() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"message":"Мы отправили письмо на new@example.com."}"#) }
        try await service.changeEmail(EmailChangeDraft(newEmail: " new@example.com ", password: "secret"))
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/auth/change-email")
        #expect(request.bodyJSON as? [String: String] == ["new_email": "new@example.com", "password": "secret"])
    }

    @Test func sessionsComeWithThisDeviceFirstThenTheNewestActivity() async throws {
        func row(_ id: String, _ seen: String, current: Bool) -> String {
            #"{"id":"\#(id)","device":"Chrome на Windows","ip_address":null,"created_at":"2026-11-01T10:00:00Z","#
                + #""last_seen_at":"\#(seen)","current":\#(current)}"#
        }
        let list = "[" + [
            row("aaaaaaaa-2222-4333-8444-555555555555", "2026-11-05T10:00:00Z", current: false),
            row("bbbbbbbb-2222-4333-8444-555555555555", "2026-11-04T10:00:00Z", current: true),
            row("cccccccc-2222-4333-8444-555555555555", "2026-11-06T10:00:00Z", current: false),
        ].joined(separator: ",") + "]"
        let sessions = try await make { _ in json(list) }.sessions()
        #expect(sessions.map(\.current) == [true, false, false])
        #expect(sessions.map { $0.id.uuidString.prefix(1) } == ["B", "C", "A"])
    }

    @Test func endingOneSessionDeletesItAndEndingAllIsAPost() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"message":"ок"}"#) }
        try await service.endSession(UUID(uuidString: one)!)
        try await service.endAllSessions()
        #expect(seen.all.map(\.httpMethod) == ["DELETE", "POST"])
        #expect(seen.all[0].url?.path == "/api/auth/sessions/\(one)" && seen.all[1].url?.path == "/api/auth/logout-all")
    }
}

struct UserAgentTests {
    @Test func theAppIntroducesItselfByNameWithoutBrowserWords() {
        let agent = APIClient.userAgent
        #expect(agent.hasPrefix("SportArena iOS "))
        // the server recognises browsers and systems by words like these and would show only those
        for word in ["Safari", "Chrome", "iPhone", "Mac OS X", "CFNetwork"] { #expect(!agent.contains(word)) }
        #expect(APIClient.makeSession().configuration.httpAdditionalHeaders?["User-Agent"] as? String == agent)
    }
}

struct PrivacyServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> AccountService {
        AccountService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    @Test func theChoiceIsReadFromTheServer() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"allow_ai_analysis_by_personal_coach":true}"#) }
        let settings = try await service.privacy()
        #expect(settings.allowAiAnalysisByPersonalCoach)
        #expect(seen.all.first?.httpMethod == "GET" && seen.all.first?.url?.path == "/api/users/me/privacy")
    }

    @Test func theChoiceIsPutAndTheAnswerIsWhatTheServerKept() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"allow_ai_analysis_by_personal_coach":false}"#) }
        let settings = try await service.setAiAnalysisAllowed(false)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/users/me/privacy")
        #expect(request.bodyJSON as? [String: Bool] == ["allow_ai_analysis_by_personal_coach": false])
        #expect(!settings.allowAiAnalysisByPersonalCoach)
    }
}
