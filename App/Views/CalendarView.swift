import SportArenaKit
import SwiftUI

struct CalendarView: View {
    @Bindable var store: CalendarStore

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Вид", selection: $store.mode) {
                    ForEach(CalendarStore.Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .accessibilityIdentifier("calendar.mode")

                if store.mode == .week { weekNavigator }

                content
            }
            .navigationTitle("Календарь")
            .navigationBarTitleDisplayMode(.large)
            .task(id: store.requestKey) { await store.reload() }
        }
    }

    // MARK: week navigation

    private var weekNavigator: some View {
        HStack {
            Button { store.shiftWeek(by: -1) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Предыдущая неделя")
                .accessibilityIdentifier("calendar.prevWeek")
            Spacer()
            VStack(spacing: 2) {
                Text(LocalDateFormat.weekRange(store.weekAnchor.startOfWeek)).font(.headline)
                    .accessibilityIdentifier("calendar.weekRange")
                if store.weekAnchor.startOfWeek != store.today.startOfWeek {
                    Button("К этой неделе") { store.goToThisWeek() }
                        .font(.footnote)
                        .accessibilityIdentifier("calendar.thisWeek")
                }
            }
            Spacer()
            Button { store.shiftWeek(by: 1) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Следующая неделя")
                .accessibilityIdentifier("calendar.nextWeek")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        switch store.load {
        case .loading:
            ProgressView("Загрузка календаря…").frame(maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Не удалось загрузить календарь", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Повторить") { Task { await store.reload() } }
            }
            .frame(maxHeight: .infinity)
        case .loaded(let events):
            switch store.mode {
            case .list: list(events)
            case .week: week(events)
            }
        }
    }

    private func list(_ events: [CalendarEvent]) -> some View {
        let grouped = CalendarGrouping.list(events, today: store.today)
        return List {
            if events.isEmpty {
                ContentUnavailableView("Пока ничего нет", systemImage: "calendar", description: Text("Здесь появятся тренировки, матчи и сроки заданий."))
                    .listRowBackground(Color.clear)
            }
            if !grouped.overdue.isEmpty {
                Section {
                    ForEach(grouped.overdue) { day in
                        ForEach(day.events) { row($0, showDay: true) }
                    }
                } header: {
                    Label("Нужно отметить: проведена или нет", systemImage: "exclamationmark.circle").foregroundStyle(.orange)
                }
            }
            daySections(grouped.upcoming)
            if !grouped.past.isEmpty {
                Section("Прошедшие") {
                    ForEach(grouped.past) { day in
                        ForEach(day.events) { row($0, showDay: true) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.reload() }
        .accessibilityIdentifier("calendar.list")
    }

    private func week(_ events: [CalendarEvent]) -> some View {
        let days = CalendarGrouping.week(events, startingAt: store.weekAnchor.startOfWeek)
        return List {
            ForEach(days) { day in
                Section {
                    if day.events.isEmpty {
                        Text("Нет событий").foregroundStyle(.secondary).font(.subheadline)
                    } else {
                        ForEach(day.events) { row($0, showDay: false) }
                    }
                } header: {
                    Text(LocalDateFormat.heading(day.date, today: store.today))
                        .fontWeight(day.date == store.today ? .bold : .regular)
                        .foregroundStyle(day.date == store.today ? Theme.primary : .secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.reload() }
        .accessibilityIdentifier("calendar.week")
    }

    @ViewBuilder private func daySections(_ days: [CalendarDay]) -> some View {
        ForEach(days) { day in
            Section(LocalDateFormat.heading(day.date, today: store.today)) {
                ForEach(day.events) { row($0, showDay: false) }
            }
        }
    }

    @ViewBuilder private func row(_ event: CalendarEvent, showDay: Bool) -> some View {
        EventLink(event: event, identifier: event.isTraining ? "calendar.training" : "calendar.event") {
            EventRow(event: event, today: store.today, showDay: showDay)
        }
    }
}

/// One entry: what kind it is, when, what, for which team, and whether it was held or cancelled.
struct EventRow: View {
    let event: CalendarEvent
    let today: LocalDate
    var showDay: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(event.isCancelled ? Color.secondary : Theme.primary)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title)
                    .font(.body.weight(.semibold))
                    .strikethrough(event.isCancelled)
                    .foregroundStyle(event.isCancelled ? .secondary : .primary)
                Text(whenText).font(.subheadline).foregroundStyle(.secondary)
                if let team = event.teamName { Text(team).font(.footnote).foregroundStyle(.secondary) }
                if let badge { Text(badge.text).font(.caption.weight(.semibold)).foregroundStyle(badge.color) }
            }
        }
        .padding(.vertical, 2)
    }

    private var symbol: String {
        switch event.kind {
        case .training: "figure.run"
        case .match: "sportscourt"
        case .taskDeadline: "checklist"
        case .other: "calendar"
        }
    }

    private var whenText: String {
        let time = event.time?.display
        if showDay { return [LocalDateFormat.shortDay(event.date), time].compactMap { $0 }.joined(separator: ", ") }
        return time ?? "Весь день"
    }

    private var badge: (text: String, color: Color)? {
        if event.isCompleted { return ("Проведена", .green) }
        if event.isCancelled { return ("Отменена", .secondary) }
        if event.isOverdue(today: today) { return ("Не отмечена", .orange) }
        return nil
    }
}
