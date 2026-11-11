import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!

struct WithdrawalTests {
    private func make(_ handler: @escaping MockServer.Handler) -> FinanceService {
        FinanceService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    private let withdrawalJSON = """
    {"id":"AAAAAAAA-2222-4333-8444-555555555551","amount_kopecks":1500000,"currency":"RUB","status":"requested","method":"sbp",
     "details_hint":"СБП · +7 ••• •••-••-89 · Сбербанк","decided_reason":null,"paid_at":null,
     "created_at":"2026-11-11T10:00:00Z","updated_at":"2026-11-11T10:00:00Z"}
    """

    private func sbpForm() -> WithdrawalForm {
        var form = WithdrawalForm(clientKey: UUID(uuidString: "11111111-2222-4333-8444-555555555599")!)
        form.amountText = "15 000"
        form.recipient = "  Иванов   Иван "
        form.bank = "Сбербанк"
        form.phone = "8 (912) 345-67-89"
        form.password = "secret-password"
        return form
    }

    // MARK: amounts

    @Test func anAmountIsReadToTheKopeckWithoutAFloatingPointNumber() {
        #expect(WithdrawalForm.kopecks(from: "15000") == 1_500_000)
        #expect(WithdrawalForm.kopecks(from: "1 500,50") == 150_050)
        #expect(WithdrawalForm.kopecks(from: "1500.5") == 150_050)
        #expect(WithdrawalForm.kopecks(from: "0,07") == 7)
        #expect(WithdrawalForm.kopecks(from: "19.99") == 1999)
        for bad in ["", "abc", "1,234", "1.2.3", "-5", ",5", "10 р", "99999999999999"] { #expect(WithdrawalForm.kopecks(from: bad) == nil, "\(bad)") }
    }

    @Test func theAmountMustBeBetweenTheMinimumAndTheAvailableBalance() {
        var form = sbpForm()
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000).isEmpty)
        form.amountText = "5000"
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)[.amount]?.contains("Минимальная сумма вывода") == true)
        form.amountText = "25000"
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)[.amount]?.contains("Недостаточно") == true)
        form.amountText = "0"
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)[.amount] != nil)
    }

    // MARK: details

    @Test func aPhoneIsAcceptedInEveryUsualWritingAndOnlyForARussianMobile() {
        for text in ["+7 912 345-67-89", "89123456789", "9123456789", "+7(912)3456789"] { #expect(WithdrawalForm.normalizedPhone(text) == "+79123456789", "\(text)") }
        for text in ["", "12345", "+7 495 123-45-67", "+1 912 345 67 89", "891234567890"] { #expect(WithdrawalForm.normalizedPhone(text) == nil, "\(text)") }
    }

    @Test func bankDetailsNeedNineAndTwentyDigitsAndAnOptionalTaxNumber() {
        var form = sbpForm()
        form.method = .bankTransfer
        let problems = form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)
        #expect(problems[.bik] != nil && problems[.account] != nil && problems[.phone] == nil && problems[.inn] == nil)
        form.bik = "044525225"; form.account = "40817 810 0000 0000 0001"; form.inn = "12345"
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)[.inn] != nil)
        form.inn = "1234567890"
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000).isEmpty)
        form.inn = ""
        #expect(form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000).isEmpty)
    }

    @Test func theNamesAndThePasswordAreRequired() {
        var form = WithdrawalForm()
        form.amountText = "15000"
        let problems = form.problems(availableKopecks: 2_000_000, minimumKopecks: 1_000_000)
        #expect(problems[.recipient] != nil && problems[.bank] != nil && problems[.phone] != nil && problems[.password] != nil)
    }

    // MARK: the request

    @Test func aWithdrawalIsSentWithTheNormalisedDetailsTheKeyAndThePassword() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(withdrawalJSON, status: 201) }
        let withdrawal = try await service.requestWithdrawal(sbpForm(), availableKopecks: 2_000_000, minimumKopecks: 1_000_000)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/finance/withdrawals")
        let raw = try #require(request.bodyData)
        let body = try #require(try JSONSerialization.jsonObject(with: raw) as? [String: Any])
        #expect(body["amount_kopecks"] as? Int == 1_500_000 && body["method"] as? String == "sbp")
        #expect(body["password"] as? String == "secret-password")
        #expect((body["client_key"] as? String)?.lowercased() == "11111111-2222-4333-8444-555555555599")
        let details = try #require(body["details"] as? [String: String])
        #expect(details == ["recipient": "Иванов Иван", "bank": "Сбербанк", "phone": "+79123456789"])
        #expect(withdrawal.status == .requested && withdrawal.amountKopecks == 1_500_000 && withdrawal.isCancelable)
    }

    @Test func aFormWithAProblemIsNeverSent() async {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(withdrawalJSON, status: 201) }
        var form = sbpForm()
        form.phone = "123"
        await #expect(throws: APIError.self) { _ = try await service.requestWithdrawal(form, availableKopecks: 2_000_000, minimumKopecks: 1_000_000) }
        #expect(seen.all.isEmpty)
    }

    @Test func theServersWordIsKeptWithItsField() async {
        let service = make { _ in
            json(#"{"error":{"code":"invalid_password","message":"Неверный пароль.","field":"password"}}"#, status: 403)
        }
        do {
            _ = try await service.requestWithdrawal(sbpForm(), availableKopecks: 2_000_000, minimumKopecks: 1_000_000)
            Issue.record("must fail")
        } catch let error as APIError {
            #expect(error.code == "invalid_password" && error.field == "password" && error.message == "Неверный пароль.")
            #expect(WithdrawalForm.Field(rawValue: error.field ?? "") == .password)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test func aRequestCanBeTakenBackOnlyBeforeItGoesToPayment() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(withdrawalJSON.replacingOccurrences(of: "\"requested\"", with: "\"canceled\"")) }
        let id = try #require(UUID(uuidString: "AAAAAAAA-2222-4333-8444-555555555551"))
        let canceled = try await service.cancelWithdrawal(id)
        #expect(seen.all.first?.url?.path == "/api/finance/withdrawals/aaaaaaaa-2222-4333-8444-555555555551/cancel")
        #expect(seen.all.first?.httpMethod == "POST" && canceled.status == .canceled && !canceled.isCancelable)
        let statuses: [(WithdrawalStatus, Bool)] = [
            (.requested, true), (.underReview, true), (.approved, false), (.processing, false), (.paid, false), (.rejected, false), (.canceled, false),
        ]
        for (status, cancelable) in statuses {
            let text = withdrawalJSON.replacingOccurrences(of: "\"requested\"", with: "\"\(status == .underReview ? "under_review" : status.rawValue)\"")
            let item = try APIClient.decoder.decode(Withdrawal.self, from: Data(text.utf8))
            #expect(item.isCancelable == cancelable, "\(status)")
        }
    }
}
