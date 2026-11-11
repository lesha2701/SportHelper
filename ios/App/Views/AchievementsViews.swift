import SportArenaKit
import SwiftUI

/// «Достижения»: the photos and videos a person put in their profile, read-only (nothing is shown while there are none).
/// A photo opens large, a video plays full screen; anyone else's material can be reported.
struct AchievementsSection: View {
    @Environment(AuthStore.self) private var auth
    let userId: UUID

    @State private var items: [ProfileMedia] = []
    @State private var openedPhoto: ProfileMedia?
    @State private var openedVideo: ProfileMedia?
    @State private var reporting: ReportTarget?

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    var body: some View {
        Group {
            if !items.isEmpty {
                Section(sag: "Достижения") {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(items) { item in
                            Button { open(item) } label: { AchievementTile(item: item) }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if userId != auth.user?.id {
                                        Button("Пожаловаться на материал", systemImage: "flag") { reporting = .media(item.fileId) }
                                    }
                                }
                                .accessibilityLabel(item.caption ?? (item.kind == .photo ? "Фото" : "Видео"))
                                .accessibilityIdentifier("achievements.item")
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .task(id: userId) { items = (try? await auth.publicProfiles.media(of: userId)) ?? [] }
        .fullScreenCover(item: $openedPhoto) { PhotoScreen(fileId: $0.fileId, caption: $0.caption) }
        .fullScreenCover(item: $openedVideo) { VideoScreen(fileId: $0.fileId) }
        .reportSheet(item: $reporting)
    }

    private func open(_ item: ProfileMedia) {
        if item.kind == .photo { openedPhoto = item } else { openedVideo = item }
    }
}

/// One photo or video of the gallery as a square: the picture itself, or a dark tile with a play sign for a video.
struct AchievementTile: View {
    let item: ProfileMedia

    var body: some View {
        ZStack {
            if item.kind == .photo {
                RemoteImageView(fileId: item.fileId)
            } else {
                Rectangle().fill(Theme.graphite)
                Image(systemName: "play.circle.fill").font(.system(size: 34)).foregroundStyle(.white.opacity(0.9))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .contentShape(Rectangle())
    }
}

/// A photo from the server, shown large on black.
struct PhotoScreen: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let fileId: UUID
    var caption: String?

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(caption ?? "Фото")
                } else if failed {
                    Text("Не удалось загрузить фото.").foregroundStyle(.white)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("photo.close") } }
            .toolbarBackground(.black, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            image = await auth.profile.image(for: fileId, thumbnail: false)
            failed = image == nil
        }
    }
}
