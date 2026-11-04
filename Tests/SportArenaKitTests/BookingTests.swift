import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

private func bookingJSON(
    status: String = "confirmed", payment: String? = "unpaid", price: String = "2500.00", completed: Bool = false, id: String = "11111111-2222-4333-8444-555555555555"
) -> String {
    let paymentField = payment.map { "\"payment_status\":\"\($0)\"," } ?? ""
    return """
    {"id":"\(id)","coach_user_id":"99999999-2222-4333-8444-555555555555","coach_full_name":"Анна Тренер","listing_id":"88888888-2222-4333-8444-555555555555",
     "listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555","athlete_full_name":"Игорь Петров","athlete_notes":null,
     "starts_at":"2026-11-05T10:00:00Z","duration_minutes":60,"format":"online","price_per_session":\(price),"currency":"RUB","status":"\(status)",
     \(paymentField)"is_completed":\(completed),"training_id":null,"training_plan_id":null,"training_plan_name":null,"training_status":null,
     "has_review":false,"has_player_review":false,"paid_at":null}
    """
}

private func decode(_ text: String) throws -> Booking { try APIClient.decoder.decode(Booking.self, from: Data(text.utf8)) }

struct MoneyTests {
    @Test func wholeRublesHaveNoKopecksAndOthersKeepThem() {
        #expect(Money.format(2500).replacingOccurrences(of: "\u{00A0}", with: " ") == "2 500 ₽")
        #expect(Money.format(Decimal(string: "2500.50")!).replacingOccurrences(of: "\u{00A0}", with: " ") == "2 500,50 ₽")
        #expect(Money.format(0).contains("0"))
    }

    @Test func aPriceFromTheServerIsExactNotAFloatingPointApproximation() throws {
        let booking = try decode(bookingJSON(price: "1234.56"))
        #expect(booking.pricePerSession == Decimal(string: "1234.56"))
        let cheap = try decode(bookingJSON(price: "0.10"))
        #expect(cheap.pricePerSession == Decimal(string: "0.1"))
    }
}

struct BookingModelTests {
    @Test func aBookingIsReadWithItsStatesAndTheServersClock() throws {
        let booking = try decode(bookingJSON())
        #expect(booking.status == .confirmed && booking.paymentStatus == .unpaid && booking.bookingFormat == .online)
        #expect(booking.day.iso == "2026-11-05" && booking.time.display == "10:00")  // the UTC hours, as the calendar shows them
        #expect(booking.coachFullName == "Анна Тренер" && booking.durationMinutes == 60)
    }

    @Test func anOlderServerWithoutPaymentInformationMeansNothingToPay() throws {
        let booking = try decode(bookingJSON(payment: nil))
        #expect(booking.paymentStatus == .notRequired && !booking.canPay)
    }

    @Test(arguments: [
        ("confirmed", "unpaid", "2500.00", false, true),
        ("confirmed", "canceled", "2500.00", false, true),    // a payment that was cancelled may be tried again
        ("confirmed", "processing", "2500.00", false, false), // a page is open already: wait for it
        ("confirmed", "paid", "2500.00", false, false),
        ("confirmed", "refund_pending", "2500.00", false, false),
        ("confirmed", "refunded", "2500.00", false, false),
        ("confirmed", "not_required", "0.00", false, false),
        ("confirmed", "unpaid", "0.00", false, false),         // a free session has nothing to pay
        ("pending", "unpaid", "2500.00", false, false),        // the coach has not confirmed yet
        ("declined", "unpaid", "2500.00", false, false),
        ("expired", "unpaid", "2500.00", false, false),
        ("cancelled", "unpaid", "2500.00", false, false),
        ("confirmed", "unpaid", "2500.00", true, false),       // the session is over
    ])
    func thePayButtonAppearsOnlyWhenPayingMakesSense(status: String, payment: String, price: String, completed: Bool, expected: Bool) throws {
        #expect(try decode(bookingJSON(status: status, payment: payment, price: price, completed: completed)).canPay == expected)
    }

    @Test(arguments: [("confirmed", "paid", true), ("confirmed", "refund_pending", true), ("confirmed", "not_required", true),
                      ("confirmed", "unpaid", false), ("confirmed", "refunded", false), ("pending", "paid", false), ("declined", "paid", false)])
    func aChatOpensOnlyForAPaidConfirmedSession(status: String, payment: String, expected: Bool) throws {
        #expect(try decode(bookingJSON(status: status, payment: payment)).hasChat == expected)
    }

    @Test func aStatusWeDoNotKnowIsKeptAndNeverPayable() throws {
        let booking = try decode(bookingJSON(status: "frozen", payment: "chargeback"))
        #expect(booking.status == .other("frozen") && booking.paymentStatus == .other("chargeback") && !booking.canPay)
        #expect(booking.status.title == "frozen")
    }

    @Test func everyStateHasRussianWording() {
        #expect(PaymentStatus.unpaid.title == "Ожидает оплаты" && PaymentStatus.paid.title == "Оплачено" && PaymentStatus.refunded.title == "Возвращено")
        #expect(PaymentStatus.processing.title == "Оплата обрабатывается" && PaymentStatus.canceled.title == "Платёж отменён")
        #expect(BookingStatus.pending.title == "Ждёт ответа тренера" && BookingStatus.confirmed.title == "Подтверждена")
    }

    @Test func aPendingRequestIsRead() throws {
        let text = """
        {"id":"11111111-2222-4333-8444-555555555555","listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555",
         "athlete_full_name":"Игорь","athlete_notes":"Левша","starts_at":"2026-11-05T10:00:00Z","duration_minutes":60,"format":"offline",
         "price_per_session":2500,"currency":"RUB","created_at":"2026-11-04T09:00:00.5Z","athlete_rating_average":4.5,"athlete_review_count":3}
        """
        let pending = try APIClient.decoder.decode(PendingBooking.self, from: Data(text.utf8))
        #expect(pending.athleteNotes == "Левша" && pending.bookingFormat == .offline && pending.time.display == "10:00" && pending.athleteReviewCount == 3)
    }
}

struct BookingRequestTests {
    @Test func aRequestIsSentWithTheSlotInstantInUTCAndTheFormat() throws {
        let slot = Date(timeIntervalSince1970: 1_793_872_800)  // 2026-11-05T10:00:00Z
        let request = BookingRequest(listingId: UUID(uuidString: "88888888-2222-4333-8444-555555555555")!, startsAt: slot, format: .offline, athleteNotes: "  Левша ")
        let object = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(request)) as? [String: Any])
        #expect(object["starts_at"] as? String == "2026-11-05T10:00:00Z")
        #expect(object["format"] as? String == "offline" && object["listing_id"] as? String == "88888888-2222-4333-8444-555555555555")
        #expect(object["athlete_notes"] as? String == "Левша")  // trimmed
    }

    @Test func emptyNotesAreNotSent() throws {
        let request = BookingRequest(listingId: UUID(), startsAt: Date(), format: .online, athleteNotes: "   ")
        let object = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(request)) as? [String: Any])
        #expect(object["athlete_notes"] == nil)
    }
}

struct PaymentStartTests {
    @Test func onlyAnHttpsPageIsEverOpenedForAPayment() {
        #expect(PaymentStart(confirmationUrl: "https://yoomoney.ru/checkout/payments/v2/contract?orderId=1").url != nil)
        for unsafe in ["http://yoomoney.ru/pay", "javascript:alert(1)", "myapp://pay", "file:///etc/passwd", "https://", "not a url", ""] {
            #expect(PaymentStart(confirmationUrl: unsafe).url == nil, "\(unsafe) must not be opened")
        }
    }
}

private extension PaymentStart {
    init(confirmationUrl: String) {
        self = try! APIClient.decoder.decode(PaymentStart.self, from: Data(#"{"confirmation_url":"\#(confirmationUrl)"}"#.utf8))  // swiftlint:disable:this force_try
    }
}

struct CoachListingTests {
    private let card = """
    {"id":"11111111-2222-4333-8444-555555555555","title":"Теннис для взрослых","description":"Индивидуально","coach_user_id":"99999999-2222-4333-8444-555555555555",
     "coach_full_name":"Анна Тренер","coach_photo_url":null,"sport":"Большой теннис","specialization":null,"experience_years":7,"average_rating":4.75,
     "review_count":4,"price_per_session":2500,"currency":"RUB","location":"Москва","offers_online":true,"offers_offline":false,"photo_file_id":null,
     "next_available_slot":"2026-11-05T10:00:00Z"}
    """

    @Test func aCardIsReadWithItsPriceFormatsAndRating() throws {
        let listing = try APIClient.decoder.decode(CoachListingCard.self, from: Data(card.utf8))
        #expect(listing.priceText?.contains("2") == true && listing.formats == [.online])
        #expect(listing.ratingText == "4,8" || listing.ratingText == "4,7")  // one decimal, a comma, as in Russian
        #expect(listing.nextAvailableSlot?.serverTime.display == "10:00")
    }

    @Test func aListingWithoutReviewsShowsNoRating() throws {
        let text = card.replacingOccurrences(of: "\"review_count\":4", with: "\"review_count\":0")
        #expect(try APIClient.decoder.decode(CoachListingCard.self, from: Data(text.utf8)).ratingText == nil)
    }

    @Test func aFreeOrUnpricedListingHasNoPriceText() throws {
        let text = card.replacingOccurrences(of: "\"price_per_session\":2500", with: "\"price_per_session\":null")
        #expect(try APIClient.decoder.decode(CoachListingCard.self, from: Data(text.utf8)).priceText == nil)
    }

    @Test func filtersBecomeQueryParametersAndEmptyOnesAreLeftOut() {
        #expect(CoachFilter().queryItems.isEmpty && CoachFilter().isEmpty)
        let filter = CoachFilter(sport: "Футбол", format: .online, location: "  Москва ", maxPrice: 3000, minRating: 4)
        let items = Dictionary(uniqueKeysWithValues: filter.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(items == ["sport": "Футбол", "format": "online", "location": "Москва", "max_price": "3000", "min_rating": "4.0"])
        #expect(CoachFilter(sport: "  ").queryItems.isEmpty)
    }

    @Test func aSlotIsTheServersInstant() throws {
        let slot = try APIClient.decoder.decode(OpenSlot.self, from: Data(#"{"starts_at":"2026-11-05T23:30:00Z","duration_minutes":60}"#.utf8))
        #expect(slot.day.iso == "2026-11-05" && slot.time.display == "23:30")
    }
}

struct BookingsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (BookingsService, APIClient) {
        let api = APIClient(baseURL: base, session: MockServer.session(handler))
        return (BookingsService(client: api), api)
    }

    @Test func requestingABookingSendsThePostWithTheToken() async throws {
        let seen = RequestLog()
        let (bookings, api) = make { request in seen.add(request); return json(bookingJSON(status: "pending"), status: 200) }
        await api.setCSRFToken("csrf-9")

        let booking = try await bookings.request(BookingRequest(listingId: UUID(), startsAt: Date(timeIntervalSince1970: 1_793_872_800), format: .online))

        #expect(booking.status == .pending)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/bookings" && request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-9")
    }

    @Test func aTakenSlotComesBackAsTheServersMessage() async {
        let (bookings, _) = make { _ in json(#"{"error":{"code":"slot_taken","message":"Это время уже занято."}}"#, status: 409) }
        do {
            _ = try await bookings.request(BookingRequest(listingId: UUID(), startsAt: Date(), format: .online))
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "slot_taken" && error.message == "Это время уже занято.")
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func theCoachConfirmsAndDeclinesByBookingId() async throws {
        let seen = RequestLog()
        let id = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
        let (bookings, _) = make { request in seen.add(request); return json(bookingJSON()) }
        _ = try await bookings.confirm(id)
        _ = try await bookings.decline(id)
        #expect(seen.all.map { $0.url?.path } == ["/api/bookings/\(id.uuidString.lowercased())/confirm", "/api/bookings/\(id.uuidString.lowercased())/decline"])
        #expect(seen.all.allSatisfy { $0.httpMethod == "POST" })
    }

    @Test func startingAPaymentSendsNoAmountAndReturnsOnlyAnHttpsPage() async throws {
        let seen = RequestLog()
        let (bookings, _) = make { request in seen.add(request); return json(#"{"confirmation_url":"https://yoomoney.ru/checkout/pay?id=1"}"#) }
        let url = try await bookings.startPayment(UUID())
        #expect(url.absoluteString == "https://yoomoney.ru/checkout/pay?id=1")
        #expect(seen.all.first?.bodyData == nil)  // the server takes the price from the booking, the app never states one
    }

    @Test func anUnsafePaymentAddressIsRefusedNotOpened() async {
        let (bookings, _) = make { _ in json(#"{"confirmation_url":"http://evil.example/pay"}"#) }
        do {
            _ = try await bookings.startPayment(UUID())
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "unsafe_payment_url")
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func anAlreadyPaidBookingCannotBePaidAgain() async {
        let (bookings, _) = make { _ in json(#"{"error":{"code":"already_paid","message":"Эта тренировка уже оплачена."}}"#, status: 409) }
        do {
            _ = try await bookings.startPayment(UUID())
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "already_paid")
        } catch { Issue.record("wrong error \(error)") }
    }
}

private actor Counter {
    private(set) var value = 0
    func next() -> Int { value += 1; return value }
}

struct PaymentPollingTests {
    private func booking(_ payment: String) throws -> Booking { try decode(bookingJSON(payment: payment)) }

    @Test func aPaymentThatIsAlreadyDecidedIsReportedAtOnce() async throws {
        let counter = Counter()
        let paid = try booking("paid")
        let result = try await PaymentPolling().settle(sync: { _ = await counter.next(); return paid }, sleep: { _ in })
        #expect(result.paymentStatus == .paid)
        #expect(await counter.value == 1)
    }

    @Test func aPaymentStillBeingConfirmedIsAskedAboutAgainUntilItSettles() async throws {
        let counter = Counter()
        let processing = try booking("processing")
        let paid = try booking("paid")
        let result = try await PaymentPolling(maxTries: 10, interval: .seconds(3)).settle(
            sync: { await counter.next() < 3 ? processing : paid }, sleep: { _ in }
        )
        #expect(result.paymentStatus == .paid)
        #expect(await counter.value == 3)
    }

    @Test func waitingIsBoundedAndTheLastKnownStateIsReturned() async throws {
        let counter = Counter()
        let processing = try booking("processing")
        let result = try await PaymentPolling(maxTries: 4, interval: .seconds(3)).settle(sync: { _ = await counter.next(); return processing }, sleep: { _ in })
        #expect(result.paymentStatus == .processing)
        #expect(await counter.value == 4)  // never more than the limit
    }

    @Test func theWaitBetweenAsksIsTheConfiguredInterval() async throws {
        let waits = WaitLog()
        let processing = try booking("processing")
        _ = try await PaymentPolling(maxTries: 3, interval: .seconds(3)).settle(sync: { processing }, sleep: { await waits.add($0) })
        #expect(await waits.all == [.seconds(3), .seconds(3)])
    }

    @Test func aFailureOnTheFirstAskIsReported() async throws {
        await #expect(throws: APIError.self) {
            _ = try await PaymentPolling().settle(sync: { throw APIError.network }, sleep: { _ in })
        }
    }

    @Test func aFailureAfterTheServerAnsweredKeepsWhatIsKnown() async throws {
        let counter = Counter()
        let processing = try booking("processing")
        let result = try await PaymentPolling().settle(
            sync: { if await counter.next() == 1 { return processing } else { throw APIError.network } }, sleep: { _ in }
        )
        #expect(result.paymentStatus == .processing)
    }

    @Test func cancellingTheScreenStopsTheWaiting() async throws {
        let processing = try booking("processing")
        let task = Task { try await PaymentPolling(maxTries: 10, interval: .seconds(3)).settle(sync: { processing }) }
        task.cancel()
        await #expect(throws: CancellationError.self) { _ = try await task.value }
    }
}

private actor WaitLog {
    private(set) var all: [Duration] = []
    func add(_ duration: Duration) { all.append(duration) }
}
