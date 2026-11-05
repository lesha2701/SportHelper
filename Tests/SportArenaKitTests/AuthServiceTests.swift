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

struct SignUpFormTests {
    private func filled(role: UserRole = .player) -> SignUpForm {
        var form = SignUpForm()
        form.firstName = " Олег "
        form.email = "oleg@example.com"
        form.password = "a long passphrase"
        form.passwordConfirm = "a long passphrase"
        form.choose(role)
        return form
    }

    @Test func anEmptyFormSaysWhatIsMissingInTheSitesWords() {
        let errors = SignUpForm().fieldErrors()

        #expect(errors[.firstName] == "Укажите имя.")
        #expect(errors[.email] == "Введите email полностью, например name@example.com.")
        #expect(errors[.password] == "Пароль слишком короткий: минимум 12 символов.")
        #expect(errors[.role] == "Выберите, кто вы: игрок или тренер.")
        #expect(errors[.passwordConfirm] == nil)  // two empty passwords agree; the short one is the problem
    }

    @Test func aPasswordThatDiffersIsReportedOnTheSecondField() {
        var form = filled()
        form.passwordConfirm = "another passphrase"
        #expect(form.fieldErrors() == [.passwordConfirm: "Пароли не совпадают."])
    }

    @Test func anAddressNeedsAnAtAndADottedDomain() {
        for good in ["a@b.co", " name@example.com ", "a.b+c@mail.example.ru"] { #expect(SignUpForm.looksLikeEmail(good), "\(good)") }
        for bad in ["", "name", "name@", "@example.com", "name@example", "name@example.c", "na me@example.com", "a@b@c.com"] {
            #expect(!SignUpForm.looksLikeEmail(bad), "\(bad)")
        }
    }

    @Test func eachRoleHasItsOwnBoxesAndNoneIsTickedInAdvance() {
        #expect(UserRole.player.consentBoxes.map(\.key) == ["terms", "personal_data"])
        #expect(UserRole.coach.consentBoxes.map(\.key) == ["coach_offer", "personal_data", "data_dissemination"])
        #expect(filled().missingConsents().count == 2)
        #expect(filled().request() == nil, "no request until every box is ticked")
    }

    @Test func switchingTheRoleStartsTheBoxesOver() {
        var form = filled(role: .player)
        for box in form.role!.consentBoxes { form.set(box, accepted: true) }
        #expect(form.missingConsents().isEmpty)

        form.choose(.coach)
        #expect(form.accepted.isEmpty, "a box ticked for the other role must never be sent")
        form.choose(.coach)
        #expect(form.accepted.isEmpty)
    }

    @Test func aCompleteFormBecomesARequestWithEveryDocumentAndItsEdition() throws {
        var form = filled(role: .coach)
        form.lastName = "  "
        for box in UserRole.coach.consentBoxes { form.set(box, accepted: true) }

        let request = try #require(form.request())

        #expect(request.firstName == "Олег" && request.lastName == nil && request.role == .coach)
        #expect(request.consents.map(\.key) == ["coach_offer", "personal_data", "data_dissemination"])
        #expect(request.consents[0].documents == [.init(key: "coach-offer", version: "2026-10-20"), .init(key: "service-terms", version: "2026-10-20")])
        #expect(request.consents[1].documents.map(\.key) == ["consent-coach", "privacy"])
    }

    @Test func aServerErrorFindsItsField() {
        #expect(SignUpForm.field(forServer: "password_confirm") == .passwordConfirm)
        #expect(SignUpForm.field(forServer: "first_name") == .firstName)
        #expect(SignUpForm.field(forServer: nil) == nil)
        #expect(SignUpForm.field(forServer: "consents") == nil)
    }

    @Test func everyDocumentHasAPathOnTheSite() {
        #expect(LegalDocument.allCases.count == 7)
        #expect(LegalDocument.coachOffer.path == "/coach-offer" && LegalDocument.privacy.path == "/privacy")
    }
}

struct EmailLettersTests {
    @Test func aConfirmationLetterCanBeSentAgainAndTheAddressIsTrimmed() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in seen.add(request); return json(#"{"message":"Письмо отправлено."}"#) })

        let message = try await AuthService(client: api).resendVerification(email: " a@b.co ")

        #expect(message == "Письмо отправлено.")
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/auth/resend-verification" && request.httpMethod == "POST")
        #expect(request.bodyJSON?["email"] as? String == "a@b.co")
    }

    @Test func aForgottenPasswordAsksTheServerForALetter() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in seen.add(request); return json(#"{"message":"Если адрес зарегистрирован, письмо отправлено."}"#) })

        let message = try await AuthService(client: api).forgotPassword(email: "a@b.co")

        #expect(message.hasPrefix("Если адрес"))
        #expect(seen.all.first?.url?.path == "/api/auth/forgot-password")
    }

    @Test func aRateLimitReachesTheCaller() async throws {
        let api = APIClient(baseURL: base, session: MockServer.session { _ in
            json(#"{"error":{"code":"rate_limited","message":"Слишком часто. Подождите.","retry_after":30}}"#, status: 429)
        })

        await #expect(throws: APIError.self) { try await AuthService(client: api).forgotPassword(email: "a@b.co") }
    }
}
