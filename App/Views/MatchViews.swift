import SportArenaKit
import SwiftUI

/// The matches of one team: what is coming, and what was played.
struct TeamMatchesView: View {
    @Environment(AuthStore.self) private var auth
    let team: Team
    @State private var load: LoadState<[TeamMatch]> = .loading
    @State private var adding = false

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка матчей…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить матчи", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let matches):
                list(matches)
            }
        }
        .sagScreen()
        .navigationTitle("Матчи")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if team.canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Добавить", systemImage: "plus") { adding = true }.accessibilityIdentifier("matches.add")
                }
            }
        }
        .task { await fetch() }
        .sheet(isPresented: $adding) { MatchFormView(mode: .add(team)) { _ in Task { await fetch() } } }
    }

    private func list(_ matches: [TeamMatch]) -> some View {
        let today = LocalDate.today()
        let upcoming = matches.filter { $0.status == .scheduled && $0.matchDate >= today }
            .sorted { ($0.matchDate, $0.startTime) < ($1.matchDate, $1.startTime) }
        let rest = matches.filter { match in !upcoming.contains { $0.id == match.id } }
            .sorted { ($0.matchDate, $0.startTime) > ($1.matchDate, $1.startTime) }
        return List {
            if matches.isEmpty {
                ContentUnavailableView(
                    "Матчей нет", systemImage: "sportscourt",
                    description: Text(team.canManage ? "Добавьте первый матч кнопкой «+»." : "Тренер ещё не добавил матчей.")
                )
                .listRowBackground(Color.clear)
            }
            section("Предстоящие", upcoming)
            section("Сыгранные и отменённые", rest)
        }
        .refreshable { await fetch() }
        .accessibilityIdentifier("matches.list")
    }

    @ViewBuilder private func section(_ title: String, _ items: [TeamMatch]) -> some View {
        if !items.isEmpty {
            Section(sag: title) {
                ForEach(items) { match in
                    NavigationLink {
                        MatchDetailView(matchId: match.id, team: team)
                    } label: {
                        MatchRow(match: match)
                    }
                    .accessibilityIdentifier("matches.row")
                }
            }
        }
    }

    private func fetch() async {
        switch await auth.matches.matches(of: team.id) {
        case .success(let matches): load = .loaded(matches)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}

private struct MatchRow: View {
    let match: TeamMatch

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text("против \(match.opponentName)").font(.headline)
                Text("\(LocalDateFormat.dayAndMonth(match.matchDate)), \(match.startTime.display) · \(match.isHome ? "дома" : "в гостях")")
                    .font(.footnote).foregroundStyle(.secondary)
                if match.status == .cancelled { Text("Отменён").font(.footnote).foregroundStyle(.secondary) }
            }
            Spacer()
            if let score = match.scoreText {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(score).font(.title3.bold().monospacedDigit())
                    if let outcome = match.outcome { Text(outcome.title).font(.caption).foregroundStyle(MatchRow.color(outcome)) }
                }
            }
        }
        .padding(.vertical, 2)
    }

    static func color(_ outcome: MatchOutcome) -> Color {
        switch outcome {
        case .win: .green
        case .loss: .red
        case .draw: .secondary
        }
    }
}

/// One match: when and where, the score, the squad. The coaching staff of the team can change all of it from here.
struct MatchDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let matchId: UUID
    let team: Team
    @State private var load: LoadState<TeamMatch> = .loading
    @State private var editing: TeamMatch?
    @State private var enteringResult: TeamMatch?
    @State private var choosingSquad: TeamMatch?
    @State private var confirmingDelete = false
    @State private var notice: String?

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить матч", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let match):
                details(match)
            }
        }
        .sagScreen()
        .navigationTitle("Матч")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let match = load.value, team.canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Изменить", systemImage: "pencil") { editing = match }.accessibilityIdentifier("match.edit")
                        Button("Удалить", systemImage: "trash", role: .destructive) { confirmingDelete = true }.accessibilityIdentifier("match.delete")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Действия с матчем")
                    .accessibilityIdentifier("match.actions")
                }
            }
        }
        .task { await fetch() }
        .sheet(item: $editing) { match in MatchFormView(mode: .edit(match)) { updated in load = .loaded(updated) } }
        .sheet(item: $enteringResult) { match in MatchResultView(match: match) { updated in load = .loaded(updated) } }
        .sheet(item: $choosingSquad) { match in MatchSquadView(match: match, team: team) { updated in load = .loaded(updated) } }
        .confirmationDialog("Удалить матч?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Он исчезнет из расписания команды.")
        }
    }

    private func details(_ match: TeamMatch) -> some View {
        List {
            if let notice {
                Section { Text(notice).foregroundStyle(.red).accessibilityIdentifier("match.notice") }
            }
            Section {
                Text("против \(match.opponentName)").font(.title3.bold()).accessibilityIdentifier("match.opponent")
                LabeledContent("Дата", value: LocalDateFormat.full(match.matchDate))
                LabeledContent("Начало", value: match.startTime.display)
                LabeledContent("Игра", value: match.isHome ? "Дома" : "В гостях")
                if let place = match.location, !place.isEmpty { LabeledContent("Место", value: place) }
                if let cup = match.tournament, !cup.isEmpty { LabeledContent("Турнир", value: cup) }
                LabeledContent("Статус", value: match.status?.title ?? match.statusRaw)
            }
            resultSection(match)
            squadSection(match)
        }
        .refreshable { await fetch() }
    }

    @ViewBuilder private func resultSection(_ match: TeamMatch) -> some View {
        if match.hasScore || team.canManage {
            Section(sag: "Результат") {
                if let score = match.scoreText {
                    HStack {
                        Text(score).font(.largeTitle.bold().monospacedDigit()).accessibilityIdentifier("match.score")
                        Spacer()
                        if let outcome = match.outcome {
                            Text(outcome.title).font(.headline).foregroundStyle(MatchRow.color(outcome)).accessibilityIdentifier("match.outcome")
                        }
                    }
                    if let comment = match.comment, !comment.isEmpty { Text(comment).font(.subheadline) }
                }
                if team.canManage {
                    Button(match.hasScore ? "Изменить результат" : "Внести результат", systemImage: "scoreboard") { enteringResult = match }
                        .accessibilityIdentifier("match.result")
                }
            }
        }
    }

    @ViewBuilder private func squadSection(_ match: TeamMatch) -> some View {
        if !match.roster.isEmpty || team.canManage {
            Section(sag: match.roster.isEmpty ? "Состав" : "Состав (\(match.roster.count))") {
                if match.roster.isEmpty { Text("Состав ещё не назван.").foregroundStyle(.secondary) }
                ForEach(match.roster) { player in Text(player.fullName).accessibilityIdentifier("match.player") }
                if team.canManage {
                    Button("Назвать состав", systemImage: "person.2") { choosingSquad = match }.accessibilityIdentifier("match.squad")
                }
            }
        }
    }

    private func fetch() async {
        switch await auth.matches.match(matchId) {
        case .success(let match): load = .loaded(match)
        case .failure(let error): if load.value == nil { load = .failed(error.message) } else { notice = error.message }
        }
    }

    private func delete() async {
        switch await auth.matches.delete(matchId) {
        case .success: dismiss()
        case .failure(let error): notice = error.message
        }
    }
}

/// Adding a match, or changing one.
struct MatchFormView: View {
    enum Mode {
        case add(Team)
        case edit(TeamMatch)
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: (TeamMatch) -> Void

    @State private var opponent = ""
    @State private var date = Date()
    @State private var time = LocalTime(hour: 19, minute: 0)!.onToday
    @State private var location = ""
    @State private var tournament = ""
    @State private var isHome = true
    @State private var status = MatchStatus.scheduled
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var isAdd: Bool { if case .add = mode { true } else { false } }

    private var input: MatchInput? {
        MatchInput(opponentName: opponent, date: LocalDate(date: date), time: LocalTime(from: time), location: location, tournament: tournament, isHome: isHome)
    }

    private var problem: String? {
        opponent.isEmpty ? nil : MatchInput.problem(opponentName: opponent, location: location, tournament: tournament)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Соперник", text: $opponent).accessibilityIdentifier("matchForm.opponent")
                    DatePicker("Дата", selection: $date, displayedComponents: .date)
                    DatePicker("Начало", selection: $time, displayedComponents: .hourAndMinute)
                    Picker("Игра", selection: $isHome) {
                        Text("Дома").tag(true)
                        Text("В гостях").tag(false)
                    }
                    .pickerStyle(.segmented)
                    TextField("Место (необязательно)", text: $location).accessibilityIdentifier("matchForm.location")
                    TextField("Турнир (необязательно)", text: $tournament).accessibilityIdentifier("matchForm.tournament")
                }
                if !isAdd {
                    Section {
                        Picker("Статус", selection: $status) {
                            ForEach(MatchStatus.allCases) { Text($0.title).tag($0) }
                        }
                    }
                }
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("matchForm.error") }
                }
            }
            .sagScreen()
            .navigationTitle(isAdd ? "Новый матч" : "Изменить матч")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isAdd ? "Добавить" : "Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("matchForm.save")
                }
            }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        if case .edit(let match) = mode {
            opponent = match.opponentName
            date = match.matchDate.startOfDay
            time = match.startTime.onToday
            location = match.location ?? ""
            tournament = match.tournament ?? ""
            isHome = match.isHome
            status = match.status ?? .scheduled
        }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let result: Result<TeamMatch, APIError>
        switch mode {
        case .add(let team): result = await auth.matches.create(input, for: team.id)
        case .edit(let match): result = await auth.matches.update(match.id, input, status: status)
        }
        switch result {
        case .success(let match):
            onDone(match)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// Entering the score of a match.
struct MatchResultView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let match: TeamMatch
    let onDone: (TeamMatch) -> Void

    @State private var ours = ""
    @State private var theirs = ""
    @State private var comment = ""
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var input: MatchResultInput? {
        guard let our = Int(ours.trimmingCharacters(in: .whitespaces)), let their = Int(theirs.trimmingCharacters(in: .whitespaces)) else { return nil }
        return MatchResultInput(ourScore: our, opponentScore: their, comment: comment)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(sag: "Счёт") {
                    HStack {
                        TextField("Мы", text: $ours).keyboardType(.numberPad).multilineTextAlignment(.center)
                            .font(.title.bold()).accessibilityIdentifier("matchResult.ours")
                        Text(":").font(.title.bold())
                        TextField("Они", text: $theirs).keyboardType(.numberPad).multilineTextAlignment(.center)
                            .font(.title.bold()).accessibilityIdentifier("matchResult.theirs")
                    }
                    Text("Слева — наши голы (очки), справа — соперника «\(match.opponentName)».").font(.footnote).foregroundStyle(.secondary)
                }
                Section(sag: "Комментарий") {
                    TextField("Как прошёл матч (необязательно)", text: $comment, axis: .vertical).lineLimit(3...8)
                        .accessibilityIdentifier("matchResult.comment")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("matchResult.error") }
                }
            }
            .sagScreen()
            .navigationTitle("Результат матча")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }.disabled(input == nil || saving).accessibilityIdentifier("matchResult.save")
                }
            }
            .onAppear {
                guard !filled else { return }
                filled = true
                ours = match.ourScore.map(String.init) ?? ""
                theirs = match.opponentScore.map(String.init) ?? ""
                comment = match.comment ?? ""
            }
        }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        switch await auth.matches.setResult(match.id, input) {
        case .success(let updated):
            onDone(updated)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// Choosing who plays in a match.
struct MatchSquadView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let match: TeamMatch
    let team: Team
    let onDone: (TeamMatch) -> Void

    @State private var players: LoadState<[TeamMember]> = .loading
    @State private var chosen: Set<UUID> = []
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                switch players {
                case .loading:
                    ProgressView()
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Не удалось загрузить игроков", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Повторить") { Task { await load() } }
                    }
                case .loaded(let members):
                    List {
                        if members.isEmpty { Text("В команде пока нет игроков.").foregroundStyle(.secondary) }
                        ForEach(members) { member in
                            Button {
                                if chosen.contains(member.userId) { chosen.remove(member.userId) } else { chosen.insert(member.userId) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(member.fullName).foregroundStyle(.primary)
                                        if let position = member.position, !position.isEmpty {
                                            Text(position).font(.footnote).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if chosen.contains(member.userId) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                                }
                            }
                            .accessibilityIdentifier("squad.player")
                            .accessibilityValue(chosen.contains(member.userId) ? "В составе" : "Не в составе")
                        }
                        if let error { Text(error).foregroundStyle(.red) }
                    }
                }
            }
            .sagScreen()
            .navigationTitle("Состав на матч")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }.disabled(players.value == nil || saving).accessibilityIdentifier("squad.save")
                }
            }
            .task {
                chosen = Set(match.roster.map(\.userId))
                await load()
            }
        }
    }

    private func load() async {
        do {
            let members = try await auth.teams.service.members(of: team.id)
            players = .loaded(members.filter { !$0.role.isStaff }.sorted { $0.fullName < $1.fullName })
        } catch let failure as APIError {
            players = .failed(failure.message)
        } catch {
            players = .failed(APIError.unknown.message)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let ordered = (players.value ?? []).map(\.userId).filter(chosen.contains)
        switch await auth.matches.setRoster(match.id, players: ordered) {
        case .success(let updated):
            onDone(updated)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}
