import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!

struct FinanceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> FinanceService {
        FinanceService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    private let summaryJSON = """
    {"currency":"RUB","available_kopecks":1250050,"pending_kopecks":225000,"reserved_kopecks":0,"paid_out_kopecks":500000,"debt_kopecks":0,
     "minimum_withdrawal_kopecks":1000000,"withdrawals_enabled":true,"can_withdraw":true,"shortfall_kopecks":0,"commission_percent":"10"}
    """

    @Test func theSummaryIsReadAsItIsAndNothingIsComputed() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(summaryJSON) }
        let summary = try await service.summary()
        #expect(seen.all.first?.url?.path == "/api/finance/summary")
        #expect(summary.availableKopecks == 1_250_050 && summary.pendingKopecks == 225_000 && summary.paidOutKopecks == 500_000)
        #expect(summary.commissionPercent == "10" && summary.canWithdraw)
        #expect(summary.withdrawalNote == nil && summary.debtNote == nil)
    }

    @Test func theNotesSayWhyThereIsNoWithdrawalAndAboutADebt() {
        #expect(FinanceSummary(withdrawalsEnabled: false).withdrawalNote == "Вывод средств пока недоступен.")
        let short = FinanceSummary(minimumWithdrawalKopecks: 1_000_000, withdrawalsEnabled: true, shortfallKopecks: 250_050)
        #expect(short.withdrawalNote?.contains("Минимальная сумма вывода") == true && short.withdrawalNote?.contains("2\u{a0}500,50") == true)
        #expect(FinanceSummary(debtKopecks: 5000).debtNote?.contains("задолженность") == true)
    }

    @Test func kopecksAreShownToTheLastKopeck() {
        #expect(Money.kopecks(125_005).contains("1\u{a0}250,05"))
        #expect(Money.kopecks(0).contains("0,00"))
        #expect(Money.kopecks(100).contains("1,00"))
    }

    @Test func aPaymentOperationShowsTheLessonWhoPaidAndTheEarningStatus() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return json("""
            {"total":3,"limit":2,"offset":0,"items":[
             {"id":"11111111-2222-4333-8444-555555555551","kind":"payment_received","created_at":"2026-11-01T10:00:00.123456Z","amount_kopecks":225000,
              "gross_kopecks":250000,"platform_fee_kopecks":25000,"trainer_kopecks":225000,"listing_title":"Теннис для взрослых",
              "starts_at":null,"earning_status":"pending","withdrawal_status":null,"refund_status":null},
             {"id":"11111111-2222-4333-8444-555555555552","kind":"withdrawal_reserved","created_at":"2026-11-02T10:00:00Z","amount_kopecks":1000000,
              "gross_kopecks":null,"platform_fee_kopecks":null,"trainer_kopecks":null,"listing_title":null,"starts_at":null,
              "earning_status":null,"withdrawal_status":"under_review","refund_status":null}]}
            """)
        }
        let page = try await service.operations(limit: 2, offset: 0)
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/finance/operations")
        #expect(request.url?.query?.contains("limit=2") == true && request.url?.query?.contains("offset=0") == true)
        #expect(page.total == 3 && page.items.count == 2 && page.hasMore)
        let payment = page.items[0]
        #expect(payment.title == "Оплата занятия получена" && payment.amountKopecks == 225_000)
        #expect(payment.details.count == 3 && payment.details[0] == "Теннис для взрослых")
        #expect(payment.details[1].hasPrefix("Игрок заплатил") && payment.details[2] == "Статус: ждёт проведения занятия")
        #expect(page.items[1].details == ["Заявка: На проверке"])
    }

    @Test func theLastPageHasNothingMoreAndAnUnknownKindOrStatusDoesNotBreakReading() async throws {
        let service = make { _ in
            json("""
            {"total":1,"limit":20,"offset":0,"items":[{"id":"11111111-2222-4333-8444-555555555553","kind":"something_new",
             "created_at":"2026-11-02T10:00:00Z","amount_kopecks":100,"withdrawal_status":"on_the_moon"}]}
            """)
        }
        let page = try await service.operations()
        #expect(!page.hasMore && page.items[0].title == "Операция" && page.items[0].withdrawalStatus == WithdrawalStatus.other)
    }

    @Test func withdrawalsAreListedWithTheirStatusAndTheHiddenDetails() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return json("""
            {"total":1,"limit":20,"offset":0,"items":[{"id":"11111111-2222-4333-8444-555555555554","amount_kopecks":1000000,"currency":"RUB",
             "status":"rejected","method":"sbp","details_hint":"СБП +7 ••• •• 21","decided_reason":"Не совпало имя получателя",
             "paid_at":null,"created_at":"2026-11-03T09:30:00Z","updated_at":"2026-11-03T10:00:00Z"}]}
            """)
        }
        let page = try await service.withdrawals(offset: 20)
        #expect(seen.all.first?.url?.path == "/api/finance/withdrawals" && seen.all.first?.url?.query?.contains("offset=20") == true)
        let item = try #require(page.items.first)
        #expect(item.status == .rejected && item.status.title == "Отклонена" && item.decidedReason == "Не совпало имя получателя")
        #expect(item.detailsHint == "СБП +7 ••• •• 21" && item.amountText.contains("10\u{a0}000,00"))
    }

    @Test func aPlayerOrASwitchedOffSectionIsTheServersOwnWords() async throws {
        let service = make { _ in
            json(#"{"error":{"code":"not_a_coach","message":"Раздел доступен только тренерам."}}"#, status: 403)
        }
        do {
            _ = try await service.summary()
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.code == "not_a_coach" && error.message == "Раздел доступен только тренерам.")
        }
    }
}
