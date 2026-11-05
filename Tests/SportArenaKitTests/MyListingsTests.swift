import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

private func time(_ text: String) -> LocalTime { LocalTime(string: text)! }
private func window(_ day: Int, _ from: String, _ to: String) -> AvailabilityWindow { AvailabilityWindow(weekday: day, start: time(from), end: time(to)) }

/// A draft that can be published.
private func ready() -> ListingDraft {
    var draft = ListingDraft()
    draft.title = "Теннис"
    draft.isListed = true
    draft.price = "2 500".replacingOccurrences(of: " ", with: "")
    draft.offersOnline = true
    draft.windows = [window(0, "10:00", "12:00")]
    return draft
}

private func listingJSON(listed: Bool = false, hidden: Bool = false) -> String {
    """
    {"id":"\(one)","coach_user_id":"99999999-2222-4333-8444-555555555555","title":"Теннис","description":null,"is_listed":\(listed),
     "price_per_session":2500,"currency":"RUB","offers_online":true,"offers_offline":false,"location":null,"session_duration_minutes":60,
     "photo_file_id":null,"video_file_id":null,"hidden_by_moderation":\(hidden),"moderation_reason":null}
    """
}

struct ListingDraftTests {
    @Test func aTitleIsAlwaysNeeded() {
        #expect(ListingDraft().problem() == "Укажите название объявления.")
        var draft = ListingDraft()
        draft.title = "   "
        #expect(draft.problem() == "Укажите название объявления." && draft.request() == nil)
    }

    @Test func aDraftNeedsNothingElseButPublishingNeedsFormatPriceDurationAndSchedule() {
        var draft = ListingDraft()
        draft.title = "Теннис"
        #expect(draft.problem() == nil)
        draft.isListed = true
        #expect(draft.problem()?.contains("формат") == true)
        draft.offersOffline = true
        #expect(draft.problem()?.contains("цену") == true)
        draft.price = "2000"
        draft.duration = ""
        #expect(draft.problem()?.contains("длительность") == true)
        draft.duration = "60"
        #expect(draft.problem()?.contains("окно в расписание") == true)
        draft.windows = [window(1, "09:00", "10:00")]
        #expect(draft.problem() == nil && draft.request() != nil)
    }

    @Test func aWindowMustEndAfterItBegins() {
        var draft = ready()
        draft.windows = [window(0, "12:00", "12:00")]
        #expect(draft.problem() == "В расписании время окончания должно быть позже времени начала.")
        draft.windows = [window(0, "13:00", "12:00")]
        #expect(draft.problem() != nil)
    }

    @Test func windowsOfOneDayMayTouchButNotOverlap() {
        var draft = ready()
        draft.windows = [window(2, "10:00", "12:00"), window(2, "12:00", "14:00"), window(3, "10:00", "12:00")]
        #expect(draft.problem() == nil)
        draft.windows = [window(2, "10:00", "12:30"), window(2, "12:00", "14:00")]
        #expect(draft.problem()?.contains("пересекаются") == true)
    }

    @Test func aPriceMayBeTypedWithACommaAndNeverBelowZero() {
        var draft = ready()
        draft.price = "2500,50"
        #expect(draft.request()?.pricePerSession == Decimal(string: "2500.50"))
        draft.price = "-5"
        #expect(draft.problem() == "Цена указана неверно.")
        draft.price = "дорого"
        #expect(draft.problem() == "Цена указана неверно.")
        draft.isListed = false
        draft.price = ""
        #expect(draft.problem() == nil && draft.request()?.pricePerSession == nil)
    }

    @Test func theRequestIsTidiedAndTextIsCutAtTheServersLimits() throws {
        var draft = ready()
        draft.title = "  Теннис  "
        draft.description = "  \n "
        draft.location = String(repeating: "я", count: 300)
        let request = try #require(draft.request())
        #expect(request.title == "Теннис" && request.description == nil && request.location?.count == 200)
    }

    @Test func anExistingOfferFillsTheFormBack() throws {
        let listing = try APIClient.decoder.decode(CoachListing.self, from: Data(listingJSON(listed: true).utf8))
        let draft = ListingDraft(listing, windows: [window(4, "18:00", "20:00")])
        #expect(draft.title == "Теннис" && draft.isListed && draft.price == "2500" && draft.duration == "60" && draft.windows.count == 1)
        #expect(draft.offersOnline && !draft.offersOffline && draft.description.isEmpty && draft.location.isEmpty)
    }

    @Test func theStatusSaysWhoHidTheOffer() throws {
        let hidden = try APIClient.decoder.decode(CoachListing.self, from: Data(listingJSON(listed: true, hidden: true).utf8))
        #expect(hidden.statusText == "Скрыто модератором")
        let draft = try APIClient.decoder.decode(CoachListing.self, from: Data(listingJSON().utf8))
        #expect(draft.statusText == "Черновик" && draft.priceText != nil)
    }
}

struct ListingsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> ListingsService {
        ListingsService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func aScheduleGoesToTheServerAsTimesWithSeconds() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("[]") }
        _ = try await service.setAvailability(UUID(uuidString: one)!, [window(0, "09:30", "11:00")])
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/coach-listings/\(one)/availability")
        let body = try #require(request.bodyData)
        let list = try #require(try JSONSerialization.jsonObject(with: body) as? [[String: Any]])
        #expect(list.first?["start_time"] as? String == "09:30:00" && list.first?["end_time"] as? String == "11:00:00")
        #expect(list.first?["weekday"] as? Int == 0)
    }

    @Test func theScheduleIsReadWithSecondsDropped() async throws {
        let service = make { _ in json(#"[{"id":"\#(one)","weekday":2,"start_time":"10:00:00","end_time":"12:30:00"}]"#) }
        let windows = try await service.availability(UUID(uuidString: one)!)
        #expect(windows == [window(2, "10:00", "12:30")])
    }

    @Test func aNewPublishedOfferIsCreatedAsADraftAndPublishedLast() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            if request.url?.path.hasSuffix("/availability") == true { return json("[]") }
            return json(listingJSON(listed: request.httpMethod == "PUT"))
        }
        let saved = try await service.save(ready(), existing: nil, scheduleLoaded: true, photo: Data([1, 2, 3]))
        let steps = seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(steps == [
            "POST /api/coach-listings", "PUT /api/coach-listings/\(one)/availability", "POST /api/coach-listings/\(one)/photo",
            "PUT /api/coach-listings/\(one)",
        ])
        #expect(seen.all.first?.bodyJSON?["is_listed"] as? Bool == false, "a new offer must be created hidden")
        #expect(seen.all.last?.bodyJSON?["is_listed"] as? Bool == true && saved.isListed)
    }

    @Test func anOldOfferIsChangedAfterItsScheduleAndNothingIsCreated() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return request.url?.path.hasSuffix("/availability") == true ? json("[]") : json(listingJSON(listed: true))
        }
        _ = try await service.save(ready(), existing: UUID(uuidString: one)!, scheduleLoaded: true)
        #expect(seen.all.map(\.httpMethod) == ["PUT", "PUT"])
        #expect(seen.all.first?.url?.path.hasSuffix("/availability") == true)
    }

    @Test func aScheduleThatCouldNotBeReadIsNeverReplaced() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(listingJSON(listed: false)) }
        var draft = ready()
        draft.isListed = false
        draft.windows = []
        _ = try await service.save(draft, existing: UUID(uuidString: one)!, scheduleLoaded: false)
        #expect(seen.all.count == 1 && seen.all.first?.url?.path.hasSuffix("/availability") == false)
    }

    @Test func aNewDraftWithNoScheduleSendsNoScheduleAtAll() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(listingJSON()) }
        var draft = ready()
        draft.isListed = false
        draft.windows = []
        _ = try await service.save(draft, existing: nil, scheduleLoaded: true)
        #expect(seen.all.count == 1 && seen.all.first?.httpMethod == "POST")
    }

    @Test func aFailedPhotoNamesTheStepAndKeepsTheCreatedOffer() async throws {
        let service = make { request in
            if request.url?.path.hasSuffix("/photo") == true {
                return json(#"{"error":{"code":"file_too_large","message":"Файл слишком большой."}}"#, status: 413)
            }
            return request.url?.path.hasSuffix("/availability") == true ? json("[]") : json(listingJSON())
        }
        do {
            _ = try await service.save(ready(), existing: nil, scheduleLoaded: true, photo: Data([1]))
            Issue.record("the save went through with a refused photo")
        } catch let failure as ListingSaveFailure {
            #expect(failure.step == .photo && failure.listingId == UUID(uuidString: one) && failure.error.code == "file_too_large")
        }
    }

    @Test func anOfferWithABookingIsRefusedDeletionWithTheServersCode() async throws {
        let service = make { _ in json(#"{"error":{"code":"listing_has_active_booking","message":"x"}}"#, status: 409) }
        do {
            try await service.delete(UUID(uuidString: one)!)
            Issue.record("deleted")
        } catch let error as APIError {
            #expect(error.code == "listing_has_active_booking")
        }
    }

    @Test func anInvalidFormIsNeverSent() async {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(listingJSON()) }
        do {
            _ = try await service.save(ListingDraft(), existing: nil, scheduleLoaded: true)
            Issue.record("sent")
        } catch {}
        #expect(seen.all.isEmpty)
    }
}
