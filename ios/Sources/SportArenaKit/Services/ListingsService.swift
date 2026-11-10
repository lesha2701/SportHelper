import Foundation

/// The step of saving an offer that failed. A save is several requests: the offer, its schedule, its photo and video, publishing.
public enum ListingSaveStep: String, Sendable {
    case listing, schedule, photo, video, publishing

    /// «объявление», «расписание»…: what to name in the sentence «не удалось сохранить …».
    public var noun: String {
        switch self {
        case .listing: "объявление"
        case .schedule: "расписание"
        case .photo: "фото"
        case .video: "видео"
        case .publishing: "публикацию"
        }
    }
}

public struct ListingSaveFailure: Error, Sendable {
    public let step: ListingSaveStep
    public let error: APIError
    /// The offer as it exists on the server by now (nil when even creating it failed): a retry changes this one instead of adding another.
    public let listingId: UUID?
}

/// The coach's own offers: list, create, change, delete, their weekly schedule and their photo and video.
public final class ListingsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/coach-listings/\(id.uuidString.lowercased())\(tail)" }

    public func mine() async throws -> [CoachListing] {
        try await client.send(.get, "/api/coach-listings/me")
    }

    public func create(_ input: ListingInput) async throws -> CoachListing {
        try await client.send(.post, "/api/coach-listings", body: input)
    }

    public func update(_ id: UUID, _ input: ListingInput) async throws -> CoachListing {
        try await client.send(.put, path(id), body: input)
    }

    /// The server refuses an offer with a pending request or an upcoming session (`listing_has_active_booking`).
    public func delete(_ id: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, path(id))
    }

    public func availability(_ id: UUID) async throws -> [AvailabilityWindow] {
        try await client.send(.get, path(id, "/availability"))
    }

    /// Replaces the whole schedule.
    public func setAvailability(_ id: UUID, _ windows: [AvailabilityWindow]) async throws -> [AvailabilityWindow] {
        try await client.send(.put, path(id, "/availability"), body: windows)
    }

    public func attachPhoto(_ photo: Data, filename: String = "listing.jpg", mimeType: String = "image/jpeg", to id: UUID) async throws -> CoachListing {
        try await client.upload(path(id, "/photo"), file: UploadFile(filename: filename, mimeType: mimeType, data: photo))
    }

    public func attachVideo(_ video: Data, filename: String = "listing.mp4", to id: UUID) async throws -> CoachListing {
        try await client.upload(path(id, "/video"), file: UploadFile(filename: filename, mimeType: VideoRules.mimeType, data: video), timeout: 180)
    }

    /// The photo, then the video; `step` says which one is being sent. nil when there is nothing to send.
    private func attach(photo: Data?, video: Data?, to id: UUID, step: inout ListingSaveStep) async throws -> CoachListing? {
        var latest: CoachListing?
        if let photo {
            step = .photo
            latest = try await attachPhoto(photo, to: id)
        }
        if let video {
            step = .video
            latest = try await attachVideo(video, to: id)
        }
        return latest
    }

    /// Saves the form the way the site does. A new offer is created as a draft (the server refuses a published one with no schedule), gets
    /// its schedule, photo and video, and is published as the last step. `scheduleLoaded` is false when the current schedule could not be
    /// read: it is then left alone, never replaced by an empty one. Throws `ListingSaveFailure` naming the step that failed.
    public func save(
        _ draft: ListingDraft, existing id: UUID?, scheduleLoaded: Bool, photo: Data? = nil, video: Data? = nil
    ) async throws -> CoachListing {
        guard let input = draft.request() else { throw ListingSaveFailure(step: .listing, error: .unknown, listingId: id) }
        let wasNew = id == nil
        var listingId = id
        var latest: CoachListing?
        var step = ListingSaveStep.listing
        do {
            if listingId == nil {
                let created = try await create(input.listed(false))
                listingId = created.id
                latest = created
            }
            guard let current = listingId else { throw APIError.unknown }
            if scheduleLoaded, !(wasNew && draft.windows.isEmpty) {
                step = .schedule
                _ = try await setAvailability(current, draft.windows)
            }
            if !wasNew {
                step = .listing
                latest = try await update(current, input)
            }
            latest = try await attach(photo: photo, video: video, to: current, step: &step) ?? latest
            if wasNew, draft.isListed {
                step = .publishing
                latest = try await update(current, input)
            }
            guard let saved = latest else { throw APIError.unknown }
            return saved
        } catch let failure as ListingSaveFailure {
            throw failure
        } catch let error as APIError {
            throw ListingSaveFailure(step: step, error: error, listingId: listingId)
        } catch {
            throw ListingSaveFailure(step: step, error: .unknown, listingId: listingId)
        }
    }
}
