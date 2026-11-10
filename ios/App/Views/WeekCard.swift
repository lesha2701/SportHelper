import SportArenaKit
import SwiftUI

/// «Эта неделя»: the seven days of the current week as a strip, and under it the events of the day that is touched (today at first).
struct WeekCard: View {
    @Environment(AuthStore.self) private var auth
    let events: [CalendarEvent]
    let today: LocalDate

    @State private var chosen: LocalDate?

    private var days: [WeekDay] { HomeLogic.week(events, today: today) }
    private var selected: WeekDay? { days.first { $0.date == (chosen ?? today) } }

    var body: some View {
        DashboardCard("Эта неделя", trailing: AnyView(Button("Календарь") { auth.router.tab = .calendar }.font(.subheadline))) {
            HStack(spacing: 6) {
                ForEach(days) { day in dayButton(day) }
            }
            if let selected { list(selected) }
        }
    }

    private func dayButton(_ day: WeekDay) -> some View {
        let isChosen = day.date == (chosen ?? today)
        return Button { chosen = day.date } label: {
            VStack(spacing: 4) {
                Text(LocalDateFormat.weekday(day.date)).font(Theme.body(12, weight: .semibold, relativeTo: .caption)).textCase(.uppercase)
                Text("\(day.date.day)").font(Theme.body(17, weight: .bold, relativeTo: .body))
                Circle().fill(day.activeCount > 0 ? (isChosen ? Color.white : Theme.primary) : Color.clear).frame(width: 6, height: 6)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .foregroundStyle(isChosen ? Color.white : (day.isToday ? Theme.primary : Theme.text))
            .background(isChosen ? Theme.primary : Theme.surfaceAlt, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                if day.isToday && !isChosen { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.primary, lineWidth: 1.5) }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(LocalDateFormat.heading(day.date, today: today)), \(day.countText.lowercased())")
        .accessibilityAddTraits(isChosen ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("home.weekDay")
    }

    @ViewBuilder
    private func list(_ day: WeekDay) -> some View {
        Text(LocalDateFormat.heading(day.date, today: today))
            .font(Theme.body(14, weight: .semibold, relativeTo: .subheadline)).foregroundStyle(Theme.textSecondary)
            .accessibilityIdentifier("home.weekHeading")
        if day.events.isEmpty {
            Text("В этот день событий нет.").foregroundStyle(.secondary).accessibilityIdentifier("home.weekEmpty")
        }
        ForEach(day.events) { event in
            EventLink(event: event, identifier: "home.weekEvent") {
                EventRow(event: event, today: today).frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
    }
}
