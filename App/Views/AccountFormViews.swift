import SportArenaKit
import SwiftUI

/// «Сменить пароль»: the old password, the new one twice. The server keeps this device signed in and signs the others out.
struct ChangePasswordView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    /// Called after the password was changed (the list of devices has changed too).
    let onChanged: () -> Void

    @State private var draft = PasswordChangeDraft()
    @State private var errors: [PasswordChangeDraft.Field: String] = [:]
    @State private var general: String?
    @State private var done: String?
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let done {
                    AuthNotice(kind: .success, text: done).accessibilityIdentifier("password.done")
                    Button("Готово") { dismiss() }.buttonStyle(.sag).accessibilityIdentifier("password.close")
                } else {
                    Text("После смены пароля вы останетесь в аккаунте на этом устройстве, а на остальных выйдете.")
                        .font(Theme.body(14)).foregroundStyle(Theme.textSecondary)
                    AuthField(label: "Текущий пароль", required: true, error: errors[.current]) {
                        PasswordInput(placeholder: "Текущий пароль", text: $draft.current, identifier: "password.current", contentType: .password)
                            .onChange(of: draft.current) { errors[.current] = nil }
                    }
                    AuthField(
                        label: "Новый пароль", required: true, error: errors[.new],
                        hint: "Минимум \(SignUpForm.minPasswordLength) символов. Подойдёт фраза из нескольких слов."
                    ) {
                        PasswordInput(placeholder: "Новый пароль", text: $draft.new, identifier: "password.new", contentType: .newPassword)
                            .onChange(of: draft.new) { errors[.new] = nil }
                    }
                    AuthField(label: "Повторите новый пароль", required: true, error: errors[.confirm]) {
                        PasswordInput(placeholder: "Повторите пароль", text: $draft.confirm, identifier: "password.confirm", contentType: .newPassword)
                            .onChange(of: draft.confirm) { errors[.confirm] = nil }
                    }
                    if let general { AuthNotice(kind: .danger, text: general).accessibilityIdentifier("password.error") }
                    Button(action: submit) {
                        if working { ProgressView().tint(.white) } else { Text("Сменить пароль") }
                    }
                    .buttonStyle(.sag)
                    .disabled(working)
                    .accessibilityIdentifier("password.submit")
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .sagScreen()
        .navigationTitle("Пароль")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        general = nil
        errors = draft.fieldErrors()
        guard errors.isEmpty else { return }
        working = true
        Task {
            defer { working = false }
            do {
                done = try await auth.account.changePassword(draft)
                draft = PasswordChangeDraft()
                onChanged()
            } catch let error as APIError {
                if let field = PasswordChangeDraft.field(forServer: error.field) { errors[field] = error.message } else { general = error.message }
            } catch {
                general = APIError.unknown.message
            }
        }
    }
}

/// «Изменить email»: the letter with the link goes to the new address; the email changes when the link is opened.
struct ChangeEmailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let currentEmail: String?

    @State private var draft = EmailChangeDraft()
    @State private var errors: [EmailChangeDraft.Field: String] = [:]
    @State private var general: String?
    @State private var done: String?
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let done {
                    AuthNotice(kind: .success, text: done).accessibilityIdentifier("email.done")
                    Text("Откройте письмо на новом адресе и перейдите по ссылке: она откроется на сайте. На старый адрес ушло предупреждение.")
                        .font(Theme.body(14)).foregroundStyle(Theme.textSecondary)
                    Button("Готово") { dismiss() }.buttonStyle(.sag).accessibilityIdentifier("email.close")
                } else {
                    if let currentEmail {
                        Text("Сейчас: \(currentEmail)").font(Theme.body(14)).foregroundStyle(Theme.textSecondary)
                    }
                    AuthField(label: "Новый email", required: true, error: errors[.email]) {
                        TextField("name@example.com", text: $draft.newEmail)
                            .keyboardType(.emailAddress).textContentType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("email.new")
                            .onChange(of: draft.newEmail) { errors[.email] = nil }
                    }
                    AuthField(
                        label: "Текущий пароль", required: true, error: errors[.password], hint: "Чтобы изменить email, нужно подтвердить, что это вы."
                    ) {
                        PasswordInput(placeholder: "Текущий пароль", text: $draft.password, identifier: "email.password", contentType: .password)
                            .onChange(of: draft.password) { errors[.password] = nil }
                    }
                    if let general { AuthNotice(kind: .danger, text: general).accessibilityIdentifier("email.error") }
                    Button(action: submit) {
                        if working { ProgressView().tint(.white) } else { Text("Отправить подтверждение") }
                    }
                    .buttonStyle(.sag)
                    .disabled(working)
                    .accessibilityIdentifier("email.submit")
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .sagScreen()
        .navigationTitle("Email")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        general = nil
        errors = draft.fieldErrors(currentEmail: currentEmail)
        guard errors.isEmpty else { return }
        working = true
        Task {
            defer { working = false }
            do {
                done = try await auth.account.changeEmail(draft)
                draft.password = ""
            } catch let error as APIError {
                if let field = EmailChangeDraft.field(forServer: error.field) { errors[field] = error.message } else { general = error.message }
            } catch {
                general = APIError.unknown.message
            }
        }
    }
}
