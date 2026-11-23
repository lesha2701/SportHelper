import SportArenaKit
import SwiftUI

/// «Подобрать тренера»: the person says what they are looking for (only the sport is required: the more is filled in, the better the match);
/// the administrators pick trainers. Below the form: the person's earlier requests and what happens with them.
struct MatchRequestView: View {
    @Environment(AuthStore.self) private var auth

    @State private var draft = MatchRequestDraft()
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?
    @State private var mine = LoadState<[MatchRequest]>.loading

    var body: some View {
        List {
            introSection
            if sent {
                Section {
                    AuthNotice(kind: .success, text: "Спасибо! Заявка отправлена. Мы изучим её и вернёмся с вариантами.")
                        .accessibilityIdentifier("match.sent")
                    Button("Отправить ещё одну") { sent = false }.accessibilityIdentifier("match.again")
                }
            } else {
                formSections
            }
            requestsSection
        }
        .sagScreen()
        .scrollDismissesKeyboard(.interactively)
        .task { await loadMine() }
        .refreshable { await loadMine() }
    }

    private var introSection: some View {
        Section {
            Text(
                "Не нашли нужного тренера в каталоге? Расскажите, что вы ищете, — мы подберём тренеров и предложим вам подходящих. "
                    + "Обязателен только вид спорта: чем больше вы заполните, тем точнее будет подбор. Ваши контакты тренерам не передаются."
            )
            .font(.subheadline).foregroundStyle(.secondary)
        }
    }

    // MARK: the form

    @ViewBuilder private var formSections: some View {
        Section(sag: "Что ищете") {
            FormField(title: "Вид спорта *") {
                TextField("Например: теннис", text: $draft.sport).accessibilityIdentifier("match.sport")
            }
            FormField(title: "Что хотите прокачать") {
                TextField("Подача, выносливость, подготовка к соревнованиям…", text: $draft.goal, axis: .vertical)
                    .lineLimit(2...5).accessibilityIdentifier("match.goal")
            }
            FormField(title: "Ваш уровень") {
                ChipRow(items: MatchLevel.allCases, selected: draft.level.map { [$0] } ?? [], title: \.title, single: true, minWidth: 130) { draft.level = $0 == draft.level ? nil : $0 }
            }
            FormField(title: "Формат занятий") {
                ChipRow(items: MatchFormat.allCases, selected: draft.format.map { [$0] } ?? [], title: \.title, single: true) { draft.format = $0 == draft.format ? nil : $0 }
            }
            FormField(title: "Город") {
                TextField("Где удобно заниматься очно", text: $draft.city).accessibilityIdentifier("match.city")
            }
        }

        Section(sag: "Бюджет и время") {
            FormField(title: "Бюджет за одно занятие, ₽", hint: draft.budgetProblem) {
                HStack {
                    TextField("От", text: $draft.budgetMin).keyboardType(.decimalPad).accessibilityIdentifier("match.budgetMin")
                    TextField("До", text: $draft.budgetMax).keyboardType(.decimalPad).accessibilityIdentifier("match.budgetMax")
                }
            }
            FormField(title: "В какие дни можете заниматься") {
                ChipRow(items: Array(0..<7), selected: draft.weekdays, title: { MatchWeekday.shortTitles[$0] }, single: false, minWidth: 44) { day in
                    if draft.weekdays.contains(day) { draft.weekdays.remove(day) } else { draft.weekdays.insert(day) }
                }
            }
            FormField(title: "В какое время суток") {
                ChipRow(items: DayPart.allCases, selected: draft.dayParts, title: \.title, single: false) { part in
                    if draft.dayParts.contains(part) { draft.dayParts.remove(part) } else { draft.dayParts.insert(part) }
                }
            }
            FormField(title: "Уточнение по времени") {
                TextField("Например: по будням после 19:00", text: $draft.scheduleNote).accessibilityIdentifier("match.note")
            }
        }

        Section(sag: "Ещё") {
            FormField(title: "Что ещё нам стоит знать") {
                TextField("Опыт, травмы, пожелания к тренеру", text: $draft.comment, axis: .vertical)
                    .lineLimit(2...6).accessibilityIdentifier("match.comment")
            }
        }

        Section {
            if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("match.error") }
            Button(sending ? "Отправляем…" : "Отправить заявку") { Task { await send() } }
                .disabled(!draft.isReady || sending)
                .accessibilityIdentifier("match.send")
        }
    }

    // MARK: the person's requests

    @ViewBuilder private var requestsSection: some View {
        switch mine {
        case .loading:
            EmptyView()
        case .failed(let message):
            Section { Text(message).font(.footnote).foregroundStyle(.red) }
        case .loaded(let requests) where !requests.isEmpty:
            Section(sag: "Ваши заявки") {
                ForEach(requests) { request in
                    MatchRequestRow(request: request) { Task { await withdraw(request) } }
                }
            }
        case .loaded:
            EmptyView()
        }
    }

    private func loadMine() async {
        do {
            mine = .loaded(try await auth.matchRequests.mine())
        } catch let failure as APIError {
            if mine.value == nil { mine = .failed(failure.message) }
        } catch {
            if mine.value == nil { mine = .failed(APIError.unknown.message) }
        }
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            _ = try await auth.matchRequests.create(draft)
            draft = MatchRequestDraft()
            sent = true
            await loadMine()
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }

    private func withdraw(_ request: MatchRequest) async {
        do {
            let updated = try await auth.matchRequests.cancel(request.id)
            mine = .loaded((mine.value ?? []).map { $0.id == updated.id ? updated : $0 })
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }
}

private struct MatchRequestRow: View {
    let request: MatchRequest
    let onWithdraw: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(request.sport).font(Theme.body(16, weight: .semibold))
                Spacer()
                Text(request.status.title).font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Color(.secondarySystemBackground), in: Capsule())
                    .accessibilityIdentifier("match.status")
            }
            ForEach(facts, id: \.0) { fact in
                HStack(alignment: .top) {
                    Text(fact.0).font(.footnote).foregroundStyle(.secondary).frame(width: 96, alignment: .leading)
                    Text(fact.1).font(.footnote)
                }
            }
            if request.status.isOpen {
                Button("Отозвать заявку", role: .destructive, action: onWithdraw).font(.footnote).buttonStyle(.borderless)
                    .accessibilityIdentifier("match.withdraw")
            }
        }
        .padding(.vertical, 2)
    }

    private var facts: [(String, String)] {
        [
            ("Цель", request.goal), ("Уровень", request.level?.title), ("Формат", request.format?.title), ("Город", request.city),
            ("Бюджет", request.budgetText), ("Когда удобно", request.whenText), ("Комментарий", request.comment),
        ].compactMap { label, value in value.map { (label, $0) } }
    }
}

/// A row of buttons shaped as pills, some of them pressed. In a List each button needs its own style (a plain button would take the whole row).
private struct ChipRow<Item: Hashable>: View {
    let items: [Item]
    let selected: Set<Item>
    let title: (Item) -> String
    /// True when pressing one chip replaces the choice (the caller toggles it off when pressed again).
    let single: Bool
    /// The narrowest a chip may be: the long words (a level) need a wide one, the days of the week a narrow one.
    let minWidth: CGFloat
    let onTap: (Item) -> Void

    init(
        items: [Item], selected: some Collection<Item>, title: @escaping (Item) -> String, single: Bool, minWidth: CGFloat = 84,
        onTap: @escaping (Item) -> Void
    ) {
        self.items = items
        self.selected = Set(selected)
        self.title = title
        self.single = single
        self.minWidth = minWidth
        self.onTap = onTap
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                let on = selected.contains(item)
                Button { onTap(item) } label: {
                    Text(title(item)).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .foregroundStyle(on ? Color.white : Color.primary)
                        .background(on ? Theme.primary : Color.primary.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("match.chip.\(title(item))")
            }
        }
    }
}
