import SportArenaKit
import SwiftUI

private struct CandidateApplication: Decodable {
    let status: String
    let adminNote: String?
    let resubmitAfter: Date?
}

struct CoachApplicationView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser
    @State private var application: CandidateApplication?
    @State private var errorMessage: String?
    @State private var deleting = false

    private var status: String { application?.status ?? user.coachApplicationStatus ?? "pending" }

    var body: some View {
        NavigationStack {
            List {
                Section("Заявка тренера") {
                    Text(statusText)
                    if let note = application?.adminNote { Text(note).foregroundStyle(.secondary) }
                    if let date = application?.resubmitAfter {
                        Text("Повторная подача доступна с \(date.formatted(date: .abbreviated, time: .omitted)).")
                    }
                    if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                    Button("Обновить статус") { Task { await reload() } }
                    if canResubmit {
                        Link("Дополнить заявку на сайте", destination: auth.client.baseURL.appendingPathComponent("login"))
                    }
                }
                Section("Аккаунт") {
                    if let email = user.email { LabeledContent("Email", value: email) }
                    NavigationLink("Безопасность аккаунта") { AccountSecurityView(user: user) }
                    Button("Удалить аккаунт", role: .destructive) { deleting = true }
                }
                Section {
                    NavigationLink("Помощь") { HelpView(ownRole: "coach") }
                    Link("Написать о заявке", destination: URL(string: "mailto:perekrestov_bus@mail.ru")!)
                    Button("Выйти") { Task { await auth.logout() } }
                }
            }
            .sagScreen()
            .navigationTitle("Заявка тренера")
            .task { await reload() }
            .sheet(isPresented: $deleting) { DeleteAccountView() }
        }
    }

    private var statusText: String {
        switch status {
        case "needs_info": "Нужны дополнительные сведения."
        case "rejected": "Сейчас мы не готовы одобрить заявку."
        case "approved": "Заявка одобрена. Обновите статус, чтобы открыть аккаунт."
        default: "Заявка на проверке. Решение придёт на email."
        }
    }

    private var canResubmit: Bool {
        status == "needs_info" || (status == "rejected" && (application?.resubmitAfter ?? .distantPast) <= .now)
    }

    private func reload() async {
        do {
            application = try await auth.client.send(.get, "/api/coach-applications/mine")
            errorMessage = nil
            await auth.refreshUser()
        } catch {
            errorMessage = "Не удалось обновить заявку. Повторите попытку."
        }
    }
}
