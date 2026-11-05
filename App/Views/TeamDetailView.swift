import SportArenaKit
import SwiftUI

/// One team: its chat, its people, and for the coaching staff the applications and the invitation.
struct TeamDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var model: TeamDetailModel
    @State private var editing = false
    @State private var confirmingLeave = false
    @State private var leaveError: String?
    @State private var asking: (action: RosterAction, member: TeamMember)?
    /// The member whose list of actions is open (the swipe shows one «Ещё» button: four long titles do not fit the screen).
    @State private var choosing: TeamMember?
    @State private var reporting: ReportTarget?
    /// The section of the hub that is open.
    @State private var hub: HubDestination?

    private enum HubDestination: Hashable { case chat, trainings, tasks, matches, library, stats }

    init(model: TeamDetailModel) { _model = State(initialValue: model) }

    private var team: Team { model.team }

    var body: some View {
        List {
            headerSection
            if let notice = model.notice {
                Section {
                    Label(notice.text, systemImage: notice.isError ? "exclamationmark.triangle" : "checkmark.circle")
                        .foregroundStyle(notice.isError ? .red : .green)
                        .accessibilityIdentifier("team.notice")
                }
            }
            chatSection
            if team.canManage { applicationsSection }
            membersSection
            if team.canManage { inviteSection }
            leaveSection
        }
        .sagScreen()
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .reportSheet(item: $reporting)
        .navigationDestination(item: $hub) { destination in
            switch destination {
            case .chat: ChatView(store: auth.chatStore(for: .team(team.id)))
            case .trainings: TeamTrainingsView(team: team)
            case .tasks: TeamTasksView(team: team)
            case .matches: TeamMatchesView(team: team)
            case .library: TeamLibraryView(team: team)
            case .stats: TeamStatsView(team: team)
            }
        }
        .toolbar {
            if team.canManage {
                ToolbarItem(placement: .topBarTrailing) { Button("Изменить") { editing = true }.accessibilityIdentifier("team.edit") }
            }
        }
        .task {
            await model.load()
            await auth.chatUnread.refresh()
        }
        .refreshable { await model.load() }
        .sheet(isPresented: $editing) { TeamFormView(mode: .edit(team)) { model.updated($0) } }
        .confirmationDialog(
            asking?.action.confirmation(for: asking?.member.fullName ?? "")?.title ?? "",
            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), titleVisibility: .visible
        ) {
            if let asking {
                Button(asking.action.title, role: .destructive) { Task { await model.perform(asking.action, on: asking.member) } }
                    .accessibilityIdentifier("team.member.confirm")
            }
        } message: {
            Text(asking?.action.confirmation(for: asking?.member.fullName ?? "")?.message ?? "")
        }
        .confirmationDialog(
            choosing?.fullName ?? "", isPresented: Binding(get: { choosing != nil }, set: { if !$0 { choosing = nil } }), titleVisibility: .visible
        ) {
            if let member = choosing { rosterButtons(rosterActions(for: member), member) }
        }
        .confirmationDialog("Выйти из команды?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Выйти из команды", role: .destructive) { Task { await leave() } }
        } message: {
            Text(team.myRole == .headCoach
                 ? "Вы главный тренер: после выхода в команде не останется главного тренера, пока не будет назначен новый."
                 : "Вы перестанете видеть команду и её чат. Вернуться можно только по новому приглашению.")
        }
    }

    // MARK: sections

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    TeamAvatar(name: team.name, size: 60)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(team.name).font(Theme.display(26, weight: .heavy, relativeTo: .title2)).foregroundStyle(Theme.panelText)
                            .fixedSize(horizontal: false, vertical: true)
                        if let role = team.myRole {
                            Text(role.title)
                                .font(Theme.display(12, relativeTo: .caption)).tracking(1).textCase(.uppercase)
                                .padding(.horizontal, 10).padding(.vertical, 4).background(Theme.primary, in: Capsule()).foregroundStyle(.white)
                        }
                    }
                }
                if team.isWithoutCoach {
                    Label("В команде нет главного тренера", systemImage: "exclamationmark.circle").font(Theme.body(13)).foregroundStyle(Theme.warning)
                }
                VStack(alignment: .leading, spacing: 4) {
                    detail("Вид спорта", team.sport)
                    if let age = team.ageCategory, !age.isEmpty { detail("Возраст", age) }
                    if let level = team.level { detail("Уровень", level.title) }
                }
                if let text = team.description, !text.isEmpty { Text(text).font(Theme.body(14)).foregroundStyle(Theme.panelText) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background { Ornament(bold: false) }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Theme.panel)
            .accessibilityElement(children: .contain)
        }
    }

    private func detail(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.panelMuted)
            Spacer()
            Text(value).foregroundStyle(Theme.panelText)
        }
        .font(Theme.body(14))
        .accessibilityElement(children: .combine)
    }

    /// The sections of the team as big tiles (the site's `hubGrid`), not as a long list of links.
    private var chatSection: some View {
        Section {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                hubButton("Чат команды", "bubble.left.and.bubble.right", .chat, id: "team.chat", badge: auth.chatUnread.unread.forTeam(team.id))
                hubButton("Тренировки", "figure.run", .trainings, id: "team.trainings")
                hubButton("Задания", "checklist", .tasks, id: "team.tasks")
                hubButton("Матчи", "sportscourt", .matches, id: "team.matches")
                hubButton("Упражнения и планы", "book", .library, id: "team.library")
                if team.canManage { hubButton("Статистика", "chart.bar", .stats, id: "team.stats") }
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    private func hubButton(_ title: String, _ symbol: String, _ destination: HubDestination, id: String, badge: Int = 0) -> some View {
        Button { hub = destination } label: { HubTile(title: title, symbol: symbol, badge: badge) }
            .buttonStyle(.borderless)
            .accessibilityIdentifier(id)
    }

    @ViewBuilder private var applicationsSection: some View {
        if !model.applications.isEmpty {
            Section(sag: "Заявки на вступление (\(model.applications.count))") {
                ForEach(model.applications) { request in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(request.fullName).font(.headline)
                        if let username = request.username, !username.isEmpty { Text("@\(username)").font(.footnote).foregroundStyle(.secondary) }
                        HStack(spacing: 12) {
                            Button { Task { await model.answer(request, accept: true) } } label: { Text("Принять").frame(maxWidth: .infinity) }
                                .buttonStyle(.borderedProminent).accessibilityIdentifier("team.accept")
                            Button(role: .destructive) { Task { await model.answer(request, accept: false) } } label: { Text("Отклонить").frame(maxWidth: .infinity) }
                                .buttonStyle(.bordered).accessibilityIdentifier("team.reject")
                        }
                        .disabled(model.busy.contains(request.id))
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("team.application")
                }
            }
        }
    }

    @ViewBuilder private var membersSection: some View {
        switch model.members {
        case .loading:
            Section(sag: "Состав") { ProgressView() }
        case .failed(let message):
            Section(sag: "Состав") {
                Text(message).foregroundStyle(.red)
                Button("Повторить") { Task { await model.load() } }
            }
        case .loaded(let members):
            Section(sag: "Состав (\(members.count))") {
                ForEach(members.sorted(by: Self.staffFirst)) { member in
                    let actions = rosterActions(for: member)
                    Group {
                        if team.canManage, member.role.isPlayer {
                            // The coaching staff opens a player's statistics from the line.
                            NavigationLink {
                                PlayerStatsView(userId: member.userId, name: member.fullName)
                            } label: {
                                memberRow(member)
                            }
                        } else {
                            memberRow(member)
                        }
                    }
                    .accessibilityIdentifier("team.member")
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if !actions.isEmpty {
                            Button { choosing = member } label: { Label("Ещё", systemImage: "ellipsis.circle") }
                                .tint(.gray)
                                .accessibilityIdentifier("team.member.more")
                        }
                        if member.userId != auth.user?.id {
                            Button { reporting = .user(member.userId) } label: { Label("Пожаловаться", systemImage: "flag") }
                                .tint(.orange)
                                .accessibilityIdentifier("team.member.report")
                        }
                    }
                    .contextMenu {
                        rosterButtons(actions, member)
                        if member.userId != auth.user?.id {
                            Button("Пожаловаться", systemImage: "flag") { reporting = .user(member.userId) }
                        }
                    }
                }
            }
        }
    }
}

extension TeamDetailView {
    private func rosterActions(for member: TeamMember) -> [RosterAction] {
        RosterAction.available(actor: team.myRole, target: member.role, isSelf: member.userId == auth.user?.id)
    }

    @ViewBuilder private func rosterButtons(_ actions: [RosterAction], _ member: TeamMember) -> some View {
        ForEach(actions, id: \.self) { action in
            Button(action.title, role: action.isDestructive ? .destructive : nil) {
                if action.confirmation(for: member.fullName) != nil { asking = (action, member) } else { Task { await model.perform(action, on: member) } }
            }
            .tint(action.isDestructive ? .red : Theme.primary)
            .disabled(model.busy.contains(member.userId))
            .accessibilityIdentifier("team.member.\(action)")
        }
    }

    private func memberRow(_ member: TeamMember) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.primary.opacity(0.15))
                Text(String(member.firstName.prefix(1)).uppercased()).font(.subheadline.bold()).foregroundStyle(Theme.primary)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text(member.fullName)
                Text([member.role.title, member.position].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var inviteSection: some View {
        Section(sag: "Приглашение") {
            if let invite = model.invite, let url = URL(string: invite.link) {
                Text(invite.link).font(.footnote).textSelection(.enabled).accessibilityIdentifier("team.inviteLink")
                Text("Действует до \(invite.expiresAt.formatted(.dateTime.day().month(.wide).hour().minute().locale(Locale(identifier: "ru_RU"))))")
                    .font(.footnote).foregroundStyle(.secondary)
                ShareLink(item: url, message: Text("Приглашение в команду «\(team.name)»")) {
                    Label("Поделиться ссылкой", systemImage: "square.and.arrow.up")
                }
                Button("Скопировать ссылку", systemImage: "doc.on.doc") { UIPasteboard.general.string = invite.link }
            }
            Button(model.invite == nil ? "Создать ссылку-приглашение" : "Создать новую ссылку", systemImage: "link.badge.plus") {
                Task { await model.createInvite() }
            }
            .accessibilityIdentifier("team.createInvite")
            Text("Игрок откроет ссылку или вставит её в приложении в разделе «Команды», и его заявка придёт вам.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var leaveSection: some View {
        Section {
            if let leaveError { Text(leaveError).font(.footnote).foregroundStyle(.red) }
            Button("Выйти из команды", role: .destructive) { confirmingLeave = true }.accessibilityIdentifier("team.leave")
        }
    }

    // MARK: actions

    private func leave() async {
        if let error = await auth.teams.leave(team) {
            leaveError = error
        } else {
            await auth.chatUnread.refresh()
            dismiss()
        }
    }

    private static func staffFirst(_ a: TeamMember, _ b: TeamMember) -> Bool {
        func rank(_ role: TeamRole) -> Int {
            switch role {
            case .headCoach: 0
            case .assistantCoach: 1
            case .captain: 2
            default: 3
            }
        }
        return (rank(a.role), a.fullName) < (rank(b.role), b.fullName)
    }
}

/// One tile of the team's hub: an icon in a red square, the name of the section, an unread badge.
private struct HubTile: View {
    let title: String
    let symbol: String
    var badge = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.primary)
                    .frame(width: 38, height: 38)
                    .background(Theme.primaryTint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Spacer()
                if badge > 0 {
                    Text("\(badge)").font(.caption.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                        .accessibilityLabel("Непрочитанных: \(badge)")
                }
            }
            Text(title)
                .font(Theme.display(17, relativeTo: .headline)).tracking(0.3).textCase(.uppercase).foregroundStyle(Theme.text)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 126, alignment: .topLeading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        .contentShape(Rectangle())
    }
}
