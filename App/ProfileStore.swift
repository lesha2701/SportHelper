import Foundation
import Observation
import SportArenaKit
import UIKit

/// The profile screen's data and the pictures it shows.
@MainActor
@Observable
final class ProfileStore {
    enum Load: Equatable {
        case loading
        case loaded(ProfileMe)
        case failed(String)
    }

    private(set) var load: Load = .loading
    private let service: ProfileService
    private let images = NSCache<NSString, UIImage>()

    init(client: APIClient) {
        service = ProfileService(client: client)
    }

    var profile: ProfileMe? {
        if case .loaded(let me) = load { return me }
        return nil
    }

    /// Forgets everything (sign-out).
    func reset() {
        load = .loading
        images.removeAllObjects()
    }

    func refresh() async {
        if profile == nil { load = .loading }
        do {
            load = .loaded(try await service.me())
        } catch let error as APIError {
            if profile == nil { load = .failed(error.message) }
        } catch {
            if profile == nil { load = .failed(APIError.unknown.message) }
        }
    }

    /// Each save returns the server's own error text (or nil when it went through) so the form can show it.
    func save(player input: PlayerProfileInput) async -> String? {
        do {
            let saved = try await service.savePlayer(input)
            load = .loaded(ProfileMe(activeMode: profile?.activeMode, player: saved, coach: profile?.coach))
            return nil
        } catch let error as APIError { return error.message } catch { return APIError.unknown.message }
    }

    func save(coach input: CoachProfileInput) async -> String? {
        do {
            let saved = try await service.saveCoach(input)
            load = .loaded(ProfileMe(activeMode: profile?.activeMode, player: profile?.player, coach: saved))
            return nil
        } catch let error as APIError { return error.message } catch { return APIError.unknown.message }
    }

    func setAvatar(photoData: Data) async -> String? {
        guard let jpeg = ImageEncoding.jpeg(from: photoData) else { return "Не удалось прочитать фото. Выберите другое." }
        do {
            _ = try await service.uploadAvatar(data: jpeg)
            return nil
        } catch let error as APIError { return error.message } catch { return APIError.unknown.message }
    }

    func removeAvatar() async -> String? {
        do {
            _ = try await service.removeAvatar()
            return nil
        } catch let error as APIError { return error.message } catch { return APIError.unknown.message }
    }

    /// An avatar picture (kept in memory once loaded; a replaced avatar has a new id, so nothing goes stale).
    func image(for fileId: UUID) async -> UIImage? {
        let key = fileId.uuidString as NSString
        if let cached = images.object(forKey: key) { return cached }
        guard let data = try? await service.fileData(id: fileId), let image = UIImage(data: data) else { return nil }
        images.setObject(image, forKey: key)
        return image
    }
}
