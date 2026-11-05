import AVKit
import PhotosUI
import SportArenaKit
import SwiftUI

/// «Выбрать видео»: the video is made an MP4, checked against the site's limits, and kept until it is uploaded with the form.
struct VideoAttachmentRow: View {
    @Binding var video: PickedVideo?
    /// Set when the server already has a video here (it is replaced by a new pick).
    let hasUploaded: Bool
    /// The length limit of this kind of video; nil where there is none.
    let limitSeconds: Int?
    let identifier: String
    @Binding var problem: String?
    @State private var item: PhotosPickerItem?
    @State private var preparing = false

    var body: some View {
        Group {
            if let video {
                HStack {
                    Label {
                        Text(video.summary).accessibilityIdentifier("video.picked")
                    } icon: {
                        Image(systemName: "video.fill")
                    }
                    Spacer()
                    Button("Убрать", role: .destructive) { self.video = nil }.buttonStyle(.borderless).accessibilityIdentifier("video.remove")
                }
            } else if hasUploaded {
                Label("Видео уже приложено", systemImage: "checkmark.circle").foregroundStyle(.green)
            }
            if preparing {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Готовим видео…").foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("video.preparing")
            }
            PhotosPicker(selection: $item, matching: .videos) {
                Label(video != nil || hasUploaded ? "Выбрать другое видео" : "Выбрать видео", systemImage: "video")
            }
            .disabled(preparing)
            .accessibilityIdentifier(identifier)
        }
        .onChange(of: item) { _, picked in
            guard let picked else { return }
            Task { await prepare(picked) }
        }
    }

    private func prepare(_ picked: PhotosPickerItem) async {
        preparing = true
        problem = nil
        defer {
            preparing = false
            item = nil
        }
        do {
            let prepared = try await VideoImport.prepare(picked)
            if let message = VideoRules.problem(bytes: prepared.data.count, seconds: prepared.seconds, limitSeconds: limitSeconds) {
                problem = message
            } else {
                video = prepared
            }
        } catch {
            problem = "Не удалось подготовить видео: выберите другое."
        }
    }
}

/// «Смотреть видео»: opens the video of a submission or an exercise full screen.
struct WatchVideoButton: View {
    let fileId: UUID
    @State private var shown = false

    var body: some View {
        Button { shown = true } label: { Label("Смотреть видео", systemImage: "play.rectangle") }
            .accessibilityIdentifier("video.watch")
            .fullScreenCover(isPresented: $shown) { VideoScreen(fileId: fileId) }
    }
}

/// A video from the server, played full screen.
struct VideoScreen: View {
    let fileId: UUID
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player {
                    VideoPlayer(player: player)
                } else if failed {
                    Text("Не удалось загрузить видео.").foregroundStyle(.white).accessibilityIdentifier("video.failed")
                } else {
                    ProgressView().tint(.white)
                }
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("video.close") } }
            .toolbarBackground(.black, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            if let url = await auth.profile.temporaryFile(for: fileId, name: "video.mp4") {
                let player = AVPlayer(url: url)
                self.player = player
                player.play()
            } else {
                failed = true
            }
        }
        .onDisappear { player?.pause() }
    }
}
