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
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
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
            if team.isWithoutCoach {
                Label("В команде нет главного тренера", systemImage: "exclamationmark.circle").foregroundStyle(.orange)
            }
            LabeledContent("Вид спорта", value: team.sport)
            if let age = team.ageCategory, !age.isEmpty { LabeledContent("Возраст", value: age) }
            if let level = team.level { LabeledContent("Уровень", value: level.title) }
            if let role = team.myRole { LabeledContent("Ваша роль", value: role.title) }
            if let text = team.description, !text.isEmpty { Text(text).font(.subheadline) }
        }
    }

    private var chatSection: some View {
        Section {
            NavigationLink {
                ChatView(store: auth.chatStore(for: .team(team.id)))
            } label: {
                HStack {
                    Label("Чат команды", systemImage: "bubble.left.and.bubble.right")
                    Spacer()
                    let unread = auth.chatUnread.unread.forTeam(team.id)
                    if unread > 0 {
                        Text("\(unread)").font(.caption.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                    }
                }
            }
            .accessibilityIdentifier("team.chat")
            NavigationLink {
                TeamTrainingsView(team: team)
            } label: {
                Label("Тренировки команды", systemImage: "figure.run")
            }
            .accessibilityIdentifier("team.trainings")
        }
    }

    @ViewBuilder private var applicationsSection: some View {
        if !model.applications.isEmpty {
            Section("Заявки на вступление (\(model.applications.count))") {
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
            Section("Состав") { ProgressView() }
        case .failed(let message):
            Section("Состав") {
                Text(message).foregroundStyle(.red)
                Button("Повторить") { Task { await model.load() } }
            }
        case .loaded(let members):
            Section("Состав (\(members.count))") {
                ForEach(members.sorted(by: Self.staffFirst)) { member in
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
                    .accessibilityIdentifier("team.member")
                }
            }
        }
    }

    private var inviteSection: some View {
        Section("Приглашение") {
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
