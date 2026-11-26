import SportArenaKit
import SwiftUI

/// The bell of the home screen: opens the feed, with the number of notifications not read yet.
struct NotificationBell: View {
    @Environment(AuthStore.self) private var auth

    private var visibleUnread: Int { auth.notifications.items.filter { $0.isUnread && FeatureVisibility.notification($0) }.count }

    var body: some View {
        NavigationLink {
            NotificationsView()
        } label: {
            Image(systemName: "bell")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
                .frame(width: 38, height: 38)
                .background(Theme.surface, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                .overlay(alignment: .topTrailing) { UnreadBadge(count: visibleUnread) }
        }
        .accessibilityLabel(visibleUnread > 0 ? "Уведомления, непрочитанных: \(visibleUnread)" : "Уведомления")
        .accessibilityIdentifier("notifications.bell")
    }
}

/// The «Уведомления» line of the profile, with the number of notifications not read yet.
struct NotificationsLink: View {
    @Environment(AuthStore.self) private var auth

    private var visibleUnread: Int { auth.notifications.items.filter { $0.isUnread && FeatureVisibility.notification($0) }.count }

    var body: some View {
        NavigationLink(value: ProfileRoute.notifications) {
            HStack {
                Label("Уведомления", systemImage: "bell")
                Spacer()
                if visibleUnread > 0 {
                    Text("\(visibleUnread)").font(.caption.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                        .accessibilityLabel("Непрочитанных: \(visibleUnread)")
                }
            }
        }
        .accessibilityIdentifier("profile.notifications")
    }
}

struct UnreadBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)").font(.caption2.bold()).foregroundStyle(.white)
                .padding(.horizontal, 5).padding(.vertical, 1).background(Theme.primary, in: Capsule())
                .offset(x: 6, y: -4)
                .accessibilityHidden(true)
        }
    }
}

/// «Уведомления»: the feed, newest first. A tap marks the notification read and opens what it is about.
struct NotificationsView: View {
    @Environment(AuthStore.self) private var auth

    private enum Destination: Hashable {
        case training(UUID, String), finance, matchOffers, myBookings, reviewBooking(UUID), incomingRequests, myTasks, chat(UUID, isTeam: Bool), settings, blogPost(UUID)
    }

    @State private var destination: Destination?
    @State private var planning = false

    private var store: NotificationsStore { auth.notifications }

    var body: some View {
        Group {
            switch store.load {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить уведомления", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await store.refresh() } }
                }
            case .loaded(let items):
                let visible = items.filter(FeatureVisibility.notification)
                if visible.isEmpty { empty } else { list(visible) }
            }
        }
        .sagMainBar("Уведомления")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if store.items.contains(where: { $0.isUnread && FeatureVisibility.notification($0) }) {
                    Button("Прочитать все") { Task { await store.markAllRead() } }.accessibilityIdentifier("notifications.readAll")
                }
                Button { destination = .settings } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Настройки уведомлений").accessibilityIdentifier("notifications.settings")
            }
        }
        .navigationDestination(item: $destination) { screen in
            switch screen {
            case .training(let id, let title): TrainingDetailView(trainingId: id, title: title, teamName: nil)
            case .finance: FinanceView()
            case .matchOffers: MatchOffersView()
            case .myBookings: MyBookingsView()
            case .reviewBooking(let id): MyBookingsView(reviewBookingId: id)
            case .incomingRequests: IncomingRequestsView()
            case .myTasks: MyTasksView()
            case .chat(let id, let isTeam): ChatView(store: auth.chatStore(for: isTeam ? .team(id) : .booking(id)))
            case .settings: NotificationSettingsView()
            case .blogPost(let id): BlogPostView(postId: id)
            }
        }
        .sheet(isPresented: $planning) { PersonalTrainingFormView { Task { await auth.calendar.reload() } } }
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
    }

    private var empty: some View {
        ContentUnavailableView("Пока нет уведомлений", systemImage: "bell", description: Text("Здесь появятся напоминания о занятиях и заявки."))
            .accessibilityIdentifier("notifications.empty")
    }

    private func list(_ items: [NotificationItem]) -> some View {
        List {
            ForEach(items) { item in
                Button { Task { await open(item) } } label: { row(item) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("notifications.row")
                    .accessibilityValue(item.isUnread ? "Не прочитано" : "Прочитано")
            }
        }
        .listStyle(.insetGrouped)
        .sagScreen()
        .accessibilityIdentifier("notifications.list")
    }

    private func row(_ item: NotificationItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.category.symbol)
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.primary)
                .frame(width: 36, height: 36).background(Theme.primaryTint, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.title).font(Theme.body(15, weight: item.isUnread ? .bold : .semibold, relativeTo: .headline)).foregroundStyle(Theme.text)
                    if item.isUnread { Circle().fill(Theme.primary).frame(width: 8, height: 8).accessibilityHidden(true) }
                }
                Text(item.body).font(Theme.body(14, relativeTo: .subheadline)).foregroundStyle(Theme.textSecondary)
                Text(item.sendAt.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(Locale(identifier: "ru_RU"))))
                    .font(Theme.body(12, relativeTo: .caption)).foregroundStyle(Theme.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    private func open(_ item: NotificationItem) async {
        async let read: Void = store.markRead(item)
        if let screen = screen(for: item) {
            destination = screen
        } else if case .match = item.target {
            auth.router.tab = .teams  // the match belongs to a team the notification does not name: the teams are the way to it
        } else if case .newPersonalTraining = item.target {
            planning = true
        } else if case .matchRequests = item.target {
            auth.router.tab = .coaches  // the trainers who agreed wait in «Подобрать тренера» of that tab
        }
        await read
    }

    /// The screen a notification leads to inside the notifications; nil for the ones that go elsewhere or only inform.
    private func screen(for item: NotificationItem) -> Destination? {
        switch item.target {
        case .training(let id): .training(id, item.title)
        case .task: .myTasks
        case .incomingBookings: .incomingRequests
        case .myBookings: .myBookings
        case .reviewBooking(let id): .reviewBooking(id)
        case .bookingChat(let id): .chat(id, isTeam: false)
        case .teamChat(let id): .chat(id, isTeam: true)
        case .finance: auth.features.trainerBalance ? .finance : nil
        case .matchOffers: .matchOffers
        case .blogPost(let id): .blogPost(id)
        case .match, .matchRequests, .newPersonalTraining, .none: nil
        }
    }
}

/// One switch per kind of notification, as on the site's profile.
struct NotificationSettingsView: View {
    @Environment(AuthStore.self) private var auth

    private var store: NotificationsStore { auth.notifications }

    var body: some View {
        List {
            if let message = store.settingsError {
                Section { Text(message).foregroundStyle(Theme.danger).accessibilityIdentifier("notificationSettings.error") }
            }
            if let preferences = store.preferences {
                Section {
                    ForEach(preferences.filter { FeatureVisibility.teams || ![.taskDeadline, .newTraining, .newMatch, .newTask, .chatTeam].contains($0.category) }) { preference in
                        Toggle(preference.category.settingsTitle, isOn: Binding(
                            get: { preference.enabled },
                            set: { value in Task { await store.set(preference.category, enabled: value) } }
                        ))
                        .tint(Theme.primary)
                        .disabled(store.savingCategory == preference.category)
                        .accessibilityIdentifier("notificationSettings.\(preference.category.rawValue)")
                    }
                } footer: {
                    Text("Оплаты и поступления приходят всегда: это служебные сообщения.")
                }
            } else if store.settingsError == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .sagMainBar("Настройки уведомлений")
        .task { await store.loadPreferences() }
    }
}
