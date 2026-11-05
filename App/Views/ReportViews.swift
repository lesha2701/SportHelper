import SportArenaKit
import SwiftUI

/// What a person is reporting: the sheet needs to know the kind, the id and how to word the question.
struct ReportTarget: Identifiable {
    let kind: ComplaintTarget
    let id: UUID
    /// «Пожаловаться на объявление», «Пожаловаться на пользователя».
    let title: String

    static func user(_ id: UUID) -> ReportTarget { ReportTarget(kind: .user, id: id, title: "Пожаловаться на пользователя") }
    static func listing(_ id: UUID) -> ReportTarget { ReportTarget(kind: .listing, id: id, title: "Пожаловаться на объявление") }
}

extension View {
    /// Shows the complaint dialog for the chosen target.
    func reportSheet(item: Binding<ReportTarget?>) -> some View {
        sheet(item: item) { ReportSheet(target: $0) }
    }
}

/// The site's «Пожаловаться» dialog: a reason from five, a comment (required for «Другая причина»), and the word that only the
/// moderators see it. Moderators get the complaint; the author is never told.
struct ReportSheet: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let target: ReportTarget

    @State private var draft = ComplaintDraft()
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if sent { thanks } else { form }
            }
            .sagScreen()
            .navigationTitle(target.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? "Закрыть" : "Отмена") { dismiss() }.accessibilityIdentifier("report.close")
                }
            }
        }
        .presentationDetents([.large])
    }

    private var form: some View {
        Form {
            Section {
                Text("Выберите причину. Жалобу увидят только модераторы, автор о ней не узнает.")
                    .font(Theme.body(14)).foregroundStyle(Theme.textSecondary)
            }
            Section(sag: "Причина") {
                ForEach(ComplaintReason.allCases) { reason in
                    Button {
                        draft.reason = reason
                    } label: {
                        HStack {
                            Text(reason.title).foregroundStyle(Theme.text)
                            Spacer()
                            if draft.reason == reason { Image(systemName: "checkmark").foregroundStyle(Theme.primary) }
                        }
                        .contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(draft.reason == reason ? .isSelected : [])
                    .accessibilityIdentifier("report.reason.\(reason.rawValue)")
                }
            }
            Section(sag: draft.needsComment ? "Опишите, что не так" : "Комментарий (необязательно)") {
                TextField("Комментарий", text: $draft.comment, axis: .vertical)
                    .lineLimit(3...8)
                    .accessibilityIdentifier("report.comment")
                    .onChange(of: draft.comment) { _, text in
                        if text.count > ComplaintDraft.maxCommentLength { draft.comment = String(text.prefix(ComplaintDraft.maxCommentLength)) }
                    }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.danger).accessibilityIdentifier("report.error") }
            }
            Section {
                Button(action: send) {
                    if sending { ProgressView().tint(.white) } else { Text("Отправить") }
                }
                .buttonStyle(.sag)
                .disabled(!draft.isReady || sending)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .accessibilityIdentifier("report.send")
            }
        }
    }

    private var thanks: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 52)).foregroundStyle(Theme.success)
            Text("Жалоба отправлена").font(Theme.display(24, relativeTo: .title2)).textCase(.uppercase).foregroundStyle(Theme.text)
            Text("Спасибо. Модераторы рассмотрят её. Автор о жалобе не узнает.")
                .font(Theme.body(15)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("report.done")
    }

    private func send() {
        sending = true
        error = nil
        Task {
            defer { sending = false }
            do {
                try await auth.complaints.report(target.kind, id: target.id, draft: draft)
                sent = true
            } catch let failure as APIError {
                error = failure.message
            } catch {
                self.error = APIError.unknown.message
            }
        }
    }
}
