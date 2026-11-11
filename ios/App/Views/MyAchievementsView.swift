import PhotosUI
import SportArenaKit
import SwiftUI

/// «Мои достижения»: the person's own gallery. Photos and videos are added from the photo library and can be taken out; others see the
/// gallery on the person's profile page (`AchievementsSection`).
struct MyAchievementsView: View {
    @Environment(AuthStore.self) private var auth
    let userId: UUID

    private enum Load { case loading, loaded, failed(String) }

    @State private var items: [ProfileMedia] = []
    @State private var load = Load.loading
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var pickedVideo: PhotosPickerItem?
    @State private var working: String?
    @State private var errorText: String?
    @State private var openedPhoto: ProfileMedia?
    @State private var openedVideo: ProfileMedia?
    @State private var deleting: ProfileMedia?

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    var body: some View {
        List {
            Section {
                PhotosPicker(selection: $pickedPhoto, matching: .images) { Label("Добавить фото", systemImage: "photo.badge.plus") }
                    .accessibilityIdentifier("achievements.addPhoto")
                PhotosPicker(selection: $pickedVideo, matching: .videos) { Label("Добавить видео", systemImage: "video.badge.plus") }
                    .accessibilityIdentifier("achievements.addVideo")
                if let working {
                    HStack(spacing: 10) { ProgressView(); Text(working).font(.footnote).foregroundStyle(Theme.textSecondary) }
                        .accessibilityIdentifier("achievements.working")
                }
                if let errorText { Text(errorText).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("achievements.error") }
            } footer: {
                Text("Видео — не длиннее \(VideoRules.maxAchievementSeconds) секунд и не больше \(VideoRules.maxBytes / 1024 / 1024) МБ. Галерею видят тренеры и игроки на вашей странице.")
            }
            .disabled(working != nil)
            gallery
        }
        .sagScreen()
        .navigationTitle("Мои достижения")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .refreshable { await reload() }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await addPhoto(item) }
        }
        .onChange(of: pickedVideo) { _, item in
            guard let item else { return }
            Task { await addVideo(item) }
        }
        .fullScreenCover(item: $openedPhoto) { PhotoScreen(fileId: $0.fileId, caption: $0.caption) }
        .fullScreenCover(item: $openedVideo) { VideoScreen(fileId: $0.fileId) }
        .confirmationDialog("Удалить из достижений?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { if let item = deleting { Task { await delete(item) } } }
            Button("Оставить", role: .cancel) {}
        } message: {
            Text("Фото или видео пропадёт со страницы. Вернуть его нельзя.")
        }
    }

    @ViewBuilder private var gallery: some View {
        switch load {
        case .loading:
            Section { ProgressView().frame(maxWidth: .infinity) }
        case .failed(let message):
            Section {
                Text(message).foregroundStyle(Theme.danger)
                Button("Повторить") { Task { await reload() } }.accessibilityIdentifier("achievements.retry")
            }
        case .loaded:
            if items.isEmpty {
                Section {
                    Text("Пока ничего нет. Добавьте фото или видео своих побед, наград и тренировок.")
                        .foregroundStyle(Theme.textSecondary).accessibilityIdentifier("achievements.empty")
                }
            } else {
                Section(sag: "Моя галерея") {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(items) { item in
                            Button { open(item) } label: { AchievementTile(item: item) }
                                .buttonStyle(.plain)
                                .contextMenu { Button("Удалить", systemImage: "trash", role: .destructive) { deleting = item } }
                                .accessibilityLabel(item.caption ?? (item.kind == .photo ? "Фото" : "Видео"))
                                .accessibilityIdentifier("achievements.item")
                        }
                    }
                    .padding(.vertical, 4)
                    Text("Нажмите и удерживайте, чтобы удалить.").font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private func open(_ item: ProfileMedia) {
        if item.kind == .photo { openedPhoto = item } else { openedVideo = item }
    }

    // MARK: loading and changing

    private func reload() async {
        do {
            items = try await auth.publicProfiles.media(of: userId)
            load = .loaded
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }

    private func addPhoto(_ item: PhotosPickerItem) async {
        defer { pickedPhoto = nil }
        errorText = nil
        working = "Загружаем фото…"
        defer { working = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
            errorText = "Не удалось прочитать фото. Выберите другое."
            return
        }
        await send { _ = try await auth.profile.addAchievement(photoData: jpeg) }
    }

    private func addVideo(_ item: PhotosPickerItem) async {
        defer { pickedVideo = nil }
        errorText = nil
        working = "Готовим видео…"
        defer { working = nil }
        let video: PickedVideo
        do {
            video = try await VideoImport.prepare(item)
        } catch {
            errorText = "Не удалось подготовить видео. Выберите другое."
            return
        }
        if let problem = VideoRules.problem(bytes: video.data.count, seconds: video.seconds, limitSeconds: VideoRules.maxAchievementSeconds) {
            errorText = problem
            return
        }
        working = "Загружаем видео (\(video.summary))…"
        await send { _ = try await auth.profile.addAchievement(videoData: video.data) }
    }

    /// Runs an upload, then reads the gallery again; the server's refusal is shown in Russian.
    private func send(_ upload: () async throws -> Void) async {
        do {
            try await upload()
            await reload()
        } catch let error as APIError {
            errorText = VideoRules.russian(code: error.code) ?? error.message
        } catch {
            errorText = APIError.unknown.message
        }
    }

    private func delete(_ item: ProfileMedia) async {
        deleting = nil
        errorText = nil
        do {
            try await auth.profile.deleteAchievement(item)
            items.removeAll { $0.id == item.id }
        } catch let error as APIError {
            errorText = error.message
        } catch {
            errorText = APIError.unknown.message
        }
    }
}
