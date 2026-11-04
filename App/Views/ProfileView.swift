import PhotosUI
import SportArenaKit
import SwiftUI

struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser
    let store: ProfileStore

    @State private var editing = false
    @State private var deleting = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var photoError: String?
    @State private var isUploading = false

    var body: some View {
        NavigationStack {
            Group {
                switch store.load {
                case .loading:
                    ProgressView("Загрузка профиля…")
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Не удалось загрузить профиль", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Повторить") { Task { await store.refresh() } }
                    }
                case .loaded(let me):
                    content(me)
                }
            }
            .navigationTitle("Профиль")
            .task { await store.refresh() }
            .refreshable { await store.refresh() }
        }
    }

    private var initial: String { String(user.firstName.first.map { String($0) } ?? "?").uppercased() }

    private func content(_ me: ProfileMe) -> some View {
        List {
            headerSection(me)
            if user.deletionRequestedAt != nil { deletionBanner }
            if me.player == nil && me.coach == nil { emptyProfileSection } else { detailsSection(me) }
            accountSection
        }
        .sheet(isPresented: $editing) { ProfileEditView(user: user, store: store, current: me) }
        .sheet(isPresented: $deleting) { DeleteAccountView() }
    }

    // MARK: sections

    private func headerSection(_ me: ProfileMe) -> some View {
        Section {
            VStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(store: store, fileId: user.avatarFileId, initial: initial, size: 96)
                    if isUploading { ProgressView().padding(6).background(.regularMaterial, in: Circle()) }
                }
                avatarMenu
                Text(displayName(me)).font(.title2.bold()).multilineTextAlignment(.center)
                Text(user.isCoach ? "Тренер" : "Игрок")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12).padding(.vertical, 4)
                    .background(Theme.primary.opacity(0.12), in: Capsule())
                    .foregroundStyle(Theme.primary)
                if let email = user.email { Text(email).font(.footnote).foregroundStyle(.secondary) }
                if let photoError { Text(photoError).font(.footnote).foregroundStyle(.red) }
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }

    private var avatarMenu: some View {
        Menu {
            PhotosPicker("Выбрать фото", selection: $pickedPhoto, matching: .images)
            if user.avatarFileId != nil {
                Button("Удалить фото", role: .destructive) { Task { await removeAvatar() } }
            }
        } label: {
            Text(user.avatarFileId == nil ? "Добавить фото" : "Изменить фото").font(.subheadline)
        }
        .accessibilityIdentifier("profile.avatarMenu")
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private func detailsSection(_ me: ProfileMe) -> some View {
        Section(user.isCoach ? "О тренере" : "О спортсмене") {
            if user.isCoach, let coach = me.coach {
                LabeledContent("Вид спорта", value: coach.sport)
                if let years = coach.experienceYears { LabeledContent("Опыт", value: Russian.years(years)) }
                if let value = coach.specialization, !value.isEmpty { LabeledContent("Специализация", value: value) }
                if let value = coach.description, !value.isEmpty { textRow("О себе", value) }
            } else if let player = me.player {
                LabeledContent("Вид спорта", value: player.sport)
                if let level = player.skillLevel { LabeledContent("Уровень", value: level.title) }
                if let age = player.age { LabeledContent("Возраст", value: Russian.years(age)) }
                if let height = player.heightCm { LabeledContent("Рост", value: "\(height) см") }
                if let weight = player.weightKg { LabeledContent("Вес", value: "\(weight.formatted()) кг") }
                if let value = player.position, !value.isEmpty { LabeledContent("Позиция", value: value) }
                if let value = player.goals, !value.isEmpty { textRow("Цель", value) }
                if let value = player.loadRestrictions, !value.isEmpty { textRow("Ограничения по нагрузке", value) }
            }
            Button("Редактировать профиль") { editing = true }
                .accessibilityIdentifier("profile.edit")
        }
    }

    private var emptyProfileSection: some View {
        Section {
            Text("Заполните профиль, чтобы пользоваться приложением.").foregroundStyle(.secondary)
            Button("Заполнить профиль") { editing = true }.accessibilityIdentifier("profile.edit")
        }
    }

    private var deletionBanner: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Аккаунт будет удалён", systemImage: "trash").font(.headline).foregroundStyle(.red)
                Text("Вы запросили удаление аккаунта. До окончания срока его можно сохранить.").font(.subheadline)
                Button("Отменить удаление") { Task { try? await auth.cancelAccountDeletion() } }
                    .accessibilityIdentifier("profile.cancelDeletion")
            }
        }
    }

    private var accountSection: some View {
        Section("Аккаунт") {
            Button("Выйти из аккаунта", role: .destructive) { Task { await auth.logout() } }
                .accessibilityIdentifier("main.logout")
            if user.deletionRequestedAt == nil {
                Button("Удалить аккаунт", role: .destructive) { deleting = true }
                    .accessibilityIdentifier("profile.delete")
            }
        }
    }

    private func textRow(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Text(value)
        }
    }

    private func displayName(_ me: ProfileMe) -> String {
        (user.isCoach ? me.coach?.fullName : me.player?.fullName) ?? user.fullName
    }

    // MARK: avatar actions

    private func upload(_ item: PhotosPickerItem) async {
        photoError = nil
        isUploading = true
        defer { isUploading = false; pickedPhoto = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            photoError = "Не удалось открыть выбранное фото."
            return
        }
        if let message = await store.setAvatar(photoData: data) { photoError = message } else { await auth.refreshUser() }
    }

    private func removeAvatar() async {
        photoError = nil
        isUploading = true
        defer { isUploading = false }
        if let message = await store.removeAvatar() { photoError = message } else { await auth.refreshUser() }
    }
}
