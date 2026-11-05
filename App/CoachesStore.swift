import Foundation
import Observation
import SportArenaKit

/// The catalogue of trainers' offers.
@MainActor
@Observable
final class CoachesStore {
    enum Load: Equatable {
        case loading
        case loaded([CoachListingCard])
        case failed(String)
    }

    private(set) var load: Load = .loading
    var filter = CoachFilter()
    private let service: CoachesService

    init(client: APIClient) {
        service = CoachesService(client: client)
    }

    func reload() async {
        let asked = filter
        if case .loaded = load {} else { load = .loading }
        do {
            let listings = try await service.listings(filter: asked)
            guard asked == filter else { return }  // the person changed the filter meanwhile: only the latest request counts
            load = .loaded(listings)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if asked == filter { load = .failed(error.message) }
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }

    func listing(id: UUID) async throws -> CoachListingProfile { try await service.listing(id: id) }

    func reviews(ofCoach id: UUID) async throws -> [CoachReview] { try await service.reviews(ofCoach: id) }

    func slots(listingId: UUID, from: LocalDate, to: LocalDate) async throws -> [OpenSlot] {
        try await service.slots(listingId: listingId, from: from, to: to)
    }

    func reset() {
        load = .loading
        filter = CoachFilter()
    }
}
