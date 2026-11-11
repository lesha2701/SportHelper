import SportArenaKit
import SwiftUI

/// The «Команды» tab: the teams the person belongs to, creating one (coaches) and joining with an invitation.
struct TeamsView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser
    @State private var creating = false
    @State private var joining = false

    private var store: TeamsStore { auth.teams }

    var body: some View {
        NavigationStack {
            content
                .sagMainBar("Команды")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            if user.isCoach {
                                Button("Создать команду", systemImage: "plus") { creating = true }.accessibilityIdentifier("teams.create")
                            }
                            Button("Вступить по приглашению", systemImage: "link") { joining = true }.accessibilityIdentifier("teams.join")
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("Добавить команду")
                        .accessibilityIdentifier("teams.add")
                    }
                }
                .task { await store.reloadMine() }
                .navigationDestination(for: Team.self) { TeamDetailView(model: auth.teams.detail(for: $0)) }
                .sheet(isPresented: $creating) { TeamFormView(mode: .create) { _ in } }
                .sheet(isPresented: $joining) { JoinTeamView() }
        }
    }

    @ViewBuilder private var content: some View {
        switch store.mine {
        case .loading:
            ProgressView("Загрузка команд…").frame(maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Не удалось загрузить команды", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Повторить") { Task { await store.reloadMine() } }
            }
        case .loaded(let teams) where teams.isEmpty:
            ContentUnavailableView {
                Label("Вы пока не в команде", systemImage: "trophy")
            } description: {
                Text(user.isCoach ? "Создайте команду или вступите в существующую по приглашению." : "Попросите у тренера ссылку-приглашение и вступите в команду.")
            } actions: {
                if user.isCoach {
                    Button("Создать команду") { creating = true }.buttonStyle(.sag).accessibilityIdentifier("teams.createEmpty")
                }
                Button("Вступить по приглашению") { joining = true }.accessibilityIdentifier("teams.joinEmpty")
            }
        case .loaded(let teams):
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(teams) { team in
                        NavigationLink(value: team) { row(team).sagCard(padding: 14) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("teams.team")
                    }
                }
                .padding(16)
            }
            .refreshable {
                await store.reloadMine()
                await auth.chatUnread.refresh()
            }
            .accessibilityIdentifier("teams.list")
        }
    }

    private func row(_ team: Team) -> some View {
        HStack(spacing: 12) {
            TeamAvatar(name: team.name, size: 48, logoFileId: team.logoFileId)
            VStack(alignment: .leading, spacing: 2) {
                Text(team.name).font(Theme.body(16, weight: .semibold, relativeTo: .headline)).foregroundStyle(Theme.text)
                Text(subtitle(team)).font(Theme.body(13, relativeTo: .subheadline)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            let unread = auth.chatUnread.unread.forTeam(team.id)
            if unread > 0 {
                Text("\(unread)").font(.caption.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                    .accessibilityLabel("Непрочитанных: \(unread)")
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.textTertiary)
        }
    }

    private func subtitle(_ team: Team) -> String {
        var parts = [team.sport]
        if let role = team.myRole { parts.append(role.title) }
        if let count = team.membersCount { parts.append(Plural.members(count)) }
        return parts.joined(separator: " · ")
    }
}

/// Russian number agreement ("1 участник", "2 участника", "5 участников").
enum Plural {
    static func members(_ count: Int) -> String {
        let last = count % 10
        let lastTwo = count % 100
        let word = (11...14).contains(lastTwo) ? "участников" : last == 1 ? "участник" : (2...4).contains(last) ? "участника" : "участников"
        return "\(count) \(word)"
    }
}
