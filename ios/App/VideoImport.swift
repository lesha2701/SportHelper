import AVFoundation
import PhotosUI
import SportArenaKit
import SwiftUI
import UniformTypeIdentifiers

/// A video picked from the photo library, already made an MP4 of at most 720p: what is uploaded.
struct PickedVideo: Equatable {
    let data: Data
    let seconds: Double
    var summary: String { VideoRules.summary(bytes: data.count, seconds: seconds) }
}

/// The picked movie as a file in a place the app owns (the picker's own copy goes away when it is done).
private struct MovieFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(ext)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return MovieFile(url: copy)
        }
    }
}

/// An export in progress. The session is touched only by the one task that runs it, which is why this can cross to the callback.
private final class ExportBox: @unchecked Sendable {
    let session: AVAssetExportSession
    init(_ session: AVAssetExportSession) { self.session = session }
}

/// Prepares a picked video for upload. An iPhone records HEVC in a MOV, often 4K: sending it as it is would be slow and over the
/// site's size limit, so it is exported as a 720p MP4 (what every browser and phone plays).
enum VideoImport {
    enum Failure: Error { case unreadable, export }

    static func prepare(_ item: PhotosPickerItem) async throws -> PickedVideo {
        guard let movie = try await item.loadTransferable(type: MovieFile.self) else { throw Failure.unreadable }
        defer { try? FileManager.default.removeItem(at: movie.url) }
        let asset = AVURLAsset(url: movie.url)
        let seconds = try await asset.load(.duration).seconds
        guard seconds.isFinite, seconds > 0 else { throw Failure.unreadable }
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: output) }
        try await export(asset, to: output)
        return PickedVideo(data: try Data(contentsOf: output), seconds: seconds)
    }

    private static func export(_ asset: AVURLAsset, to url: URL) async throws {
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else { throw Failure.export }
        session.outputURL = url
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        let box = ExportBox(session)
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            box.session.exportAsynchronously { continuation.resume() }
        }
        guard box.session.status == .completed else { throw box.session.error ?? Failure.export }
    }
}
