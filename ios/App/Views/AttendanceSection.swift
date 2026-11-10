import SportArenaKit
import SwiftUI

/// Who was at a training of a team. The coaching staff (and the responsible player of an independent training) mark those who were not;
/// the marks are what a task «для не пришедших» is given to, and what the attendance statistics count.
struct AttendanceSection: View {
    @Environment(AuthStore.self) private var auth
    let trainingId: UUID
    let teamId: UUID

    @State private var rows: [Attendance]?
    @State private var busy: Set<UUID> = []
    @State private var error: String?

    var body: some View {
        Section {
            if let rows {
                Text(rows.summary).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("training.attendanceSummary")
                ForEach(rows) { row in
                    Toggle(isOn: Binding(get: { row.status == .present }, set: { present in
                        Task { await mark(row, present ? .present : .absent) }
                    })) {
                        Text(row.fullName)
                    }
                    .disabled(busy.contains(row.userId))
                    .accessibilityIdentifier("training.attendance")
                }
            } else if error == nil {
                ProgressView()
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("training.attendanceError")
                Button("Повторить") { Task { await load() } }
            }
        } header: {
            Text("Посещаемость")
        } footer: {
            Text("Отметьте тех, кого не было: им можно дать задание «Не пришедшим» и это видно в статистике.")
        }
        .task(id: trainingId) { await load() }
    }

    private func load() async {
        error = nil
        // The server keeps a line for every member; the coaching staff does not need to be marked, so only the players are listed.
        let staff = Set(((try? await auth.teams.service.members(of: teamId)) ?? []).filter { $0.role.isStaff }.map(\.userId))
        switch await auth.trainings.attendance(of: trainingId) {
        case .success(let list): rows = list.filter { !staff.contains($0.userId) }.sorted { $0.fullName < $1.fullName }
        case .failure(let failure): error = failure.message
        }
    }

    private func mark(_ row: Attendance, _ status: AttendanceStatus) async {
        busy.insert(row.userId)
        defer { busy.remove(row.userId) }
        switch await auth.trainings.setAttendance(status, of: row.userId, at: trainingId) {
        case .success(let saved):
            error = nil
            rows = rows?.map { $0.userId == saved.userId ? saved : $0 }
        case .failure(let failure):
            error = failure.message
        }
    }
}
