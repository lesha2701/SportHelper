import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

struct AuthServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (AuthService, APIClient) {
        let api = APIClient(baseURL: base, session: MockServer.session(handler))
        return (AuthService(client: api), api)
    }

    @Test func signingInSendsTheCredentialsAndRemembersTheCSRFToken() async throws {
        let seen = RequestLog()
        let (auth, api) = make { request in seen.add(request); return json(userJSON) }

        let user = try await auth.login(email: "  anna@example.com ", password: "secret phrase")

        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/auth/login")
        #expect(request.bodyJSON?["email"] as? String == "anna@example.com")  // trimmed
        #expect(request.bodyJSON?["password"] as? String == "secret phrase")
        #expect(user.firstName == "Анна" && user.fullName == "Анна Тренер" && user.isCoach)
        #expect(user.id == UUID(uuidString: "11111111-2222-4333-8444-555555555555"))
        #expect(await api.csrfToken() == "csrf-abc")
    }

    @Test func aWrongPasswordIsTheServersRussianMessageAndKeepsNoToken() async throws {
        let (auth, api) = make { _ in json(#"{"error":{"code":"invalid_credentials","message":"Неверный email или пароль."}}"#, status: 401) }

        await #expect(throws: APIError.self) { try await auth.login(email: "a@b.c", password: "nope") }
        #expect(await api.csrfToken() == nil)
    }

    @Test func startingTheAppAsksWhoIsSignedInAndRefreshesTheToken() async throws {
        let (auth, api) = make { request in
            #expect(request.url?.path == "/api/auth/me" && request.httpMethod == "GET")
            return json(userJSON)
        }

        let user = try await auth.currentUser()

        #expect(user.email == "anna@example.com")
        #expect(await api.csrfToken() == "csrf-abc")
    }

    @Test func signingOutForgetsTheToken() async throws {
        let (auth, api) = make { _ in json(#"{"message":"Вы вышли."}"#) }
        await api.setCSRFToken("csrf-abc")

        try await auth.logout()
        try await Task.sleep(for: .milliseconds(50))  // the token is cleared right after the call returns

        #expect(await api.csrfToken() == nil)
    }

    @Test func signingUpSendsEveryTickedBoxWithItsDocuments() async throws {
        let seen = RequestLog()
        let (auth, _) = make { request in seen.add(request); return json(#"{"email":"new@example.com","verification_sent":true}"#, status: 201) }

        let result = try await auth.register(RegistrationRequest(
            firstName: "Олег", email: "new@example.com", password: "a long passphrase", passwordConfirm: "a long passphrase", role: .coach,
            consents: [ConsentAcceptance(key: "terms", documents: [.init(key: "terms", version: "2026-10-18")])]
        ))

        #expect(result.email == "new@example.com" && result.verificationSent == true)
        let body = try #require(seen.all.first?.bodyJSON)
        #expect(body["first_name"] as? String == "Олег" && body["password_confirm"] as? String == "a long passphrase" && body["role"] as? String == "coach")
        let consents = try #require(body["consents"] as? [[String: Any]])
        #expect(consents.first?["key"] as? String == "terms")
        #expect((consents.first?["documents"] as? [[String: String]])?.first == ["key": "terms", "version": "2026-10-18"])
        #expect(body["last_name"] == nil)  // not sent when empty
    }

    @Test func featuresMissingFromTheServerAreOff() async throws {
        let (auth, _) = make { _ in json(#"{"payments":true}"#) }

        let features = try await auth.features()

        #expect(features == ServerFeatures(telegram: false, payments: true, trainerBalance: false, trainerWithdrawals: false))
    }

    @Test func allFeaturesAreReadWhenThePresent() async throws {
        let (auth, _) = make { _ in json(#"{"telegram":false,"payments":true,"trainer_balance":true,"trainer_withdrawals":true}"#) }
        #expect(try await auth.features() == ServerFeatures(telegram: false, payments: true, trainerBalance: true, trainerWithdrawals: true))
    }
}
