import PhotosUI
import SportArenaKit
import SwiftUI

struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppearanceStore.self) private var appearance
    let user: AuthUser
    let store: ProfileStore

    @State private var editing = false
    @State private var deleting = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var photoError: String?
    @State private var isUploading = false

    var body: some View {
        @Bindable var router = auth.router
        return NavigationStack(path: $router.profilePath) {
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
            .sagMainBar("Профиль")
            .navigationDestination(for: ProfileRoute.self) { route in
                switch route {
                case .myBookings: MyBookingsView()
                case .incomingRequests: IncomingRequestsView()
                case .coachBookings: CoachBookingsView()
                case .bookingChat(let id): ChatView(store: auth.chatStore(for: .booking(id)))
                case .myTasks: MyTasksView()
                case .coachCatalog: CoachesView(store: auth.coaches, embedded: true)
                case .myStats: PlayerStatsView(userId: user.id)
                }
            }
            .task {
                await store.refresh()
                if user.isCoach { await auth.bookings.reloadPending() }
            }
            .refreshable { await store.refresh() }
        }
    }

    private var initial: String { String(user.firstName.first.map { String($0) } ?? "?").uppercased() }

    private func content(_ me: ProfileMe) -> some View {
        List {
            headerSection(me)
            if user.deletionRequestedAt != nil { deletionBanner }
            if me.player == nil && me.coach == nil { emptyProfileSection } else { detailsSection(me) }
            trainingsSection
            appearanceSection
            accountSection
            aboutSection
        }
        .sagScreen()
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
                Text(displayName(me)).font(Theme.display(26, weight: .heavy, relativeTo: .title2))
                    .foregroundStyle(Theme.panelText).multilineTextAlignment(.center)
                Text(user.isCoach ? "Тренер" : "Игрок")
                    .font(Theme.display(13, relativeTo: .caption)).tracking(1).textCase(.uppercase)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(Theme.primary, in: Capsule())
                    .foregroundStyle(.white)
                if let email = user.email { Text(email).font(Theme.body(13)).foregroundStyle(Theme.panelMuted) }
                if let photoError { Text(photoError).font(.footnote).foregroundStyle(Theme.danger) }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            .background { Ornament(bold: false) }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Theme.panel)
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
        Section(sag: user.isCoach ? "О тренере" : "О спортсмене") {
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

    /// The person's lessons: an athlete's bookings, a coach's inbox and sessions (reached from the profile, like on the site).
    private var trainingsSection: some View {
        Section(sag: "Тренировки") {
            if user.isCoach {
                NavigationLink(value: ProfileRoute.incomingRequests) {
                    HStack {
                        Label("Входящие заявки", systemImage: "tray")
                        Spacer()
                        if auth.bookings.pendingCount > 0 {
                            Text("\(auth.bookings.pendingCount)").font(.caption.bold()).foregroundStyle(.white)
                                .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                        }
                    }
                }
                .accessibilityIdentifier("profile.requests")
                NavigationLink(value: ProfileRoute.coachBookings) { Label("Записи", systemImage: "calendar") }
                    .accessibilityIdentifier("profile.coachBookings")
            } else {
                NavigationLink(value: ProfileRoute.myBookings) { Label("Мои брони", systemImage: "calendar.badge.clock") }
                    .accessibilityIdentifier("profile.myBookings")
            }
            NavigationLink(value: ProfileRoute.myTasks) { Label("Мои задания", systemImage: "checklist") }
                .accessibilityIdentifier("profile.myTasks")
            NavigationLink(value: ProfileRoute.myStats) { Label("Моя статистика", systemImage: "chart.bar") }
                .accessibilityIdentifier("profile.stats")
            if user.isCoach {
                // A phone's tab bar holds five tabs: a coach has «Библиотека» in the place of «Тренеры», which is reached from here.
                NavigationLink(value: ProfileRoute.coachCatalog) { Label("Каталог тренеров", systemImage: "person.2") }
                    .accessibilityIdentifier("profile.coachCatalog")
            }
        }
    }

    /// The light and the dark theme of the site, or the phone's own setting.
    private var appearanceSection: some View {
        @Bindable var appearance = appearance
        return Section(sag: "Оформление") {
            Picker("Тема", selection: $appearance.choice) {
                ForEach(AppearanceChoice.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("profile.appearance")
        }
    }

    /// The name of the project: the emblem, what it is, the version.
    private var aboutSection: some View {
        Section {
            VStack(spacing: 8) {
                BrandLogo(size: 64)
                Text("SportArenaGlobal").font(Theme.display(20, relativeTo: .title3)).tracking(0.8).textCase(.uppercase).foregroundStyle(Theme.text)
                Text("Платформа для игроков и тренеров").font(Theme.body(13)).foregroundStyle(Theme.textSecondary)
                Text("Версия \(Self.version)").font(Theme.body(12)).foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("profile.about")
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
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
        Section(sag: "Аккаунт") {
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
