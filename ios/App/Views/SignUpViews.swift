import SportArenaKit
import SwiftUI

/// A labelled field of the sign-up and recovery screens: the label above, the box, the server's or form's complaint below.
struct AuthField<Content: View>: View {
    let label: String
    var required = false
    var error: String?
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label).font(Theme.body(13, weight: .semibold, relativeTo: .subheadline)).foregroundStyle(Theme.text)
                if required { Text("*").foregroundStyle(Theme.primary).accessibilityHidden(true) }
            }
            content
                .fieldBox()
                .overlay {
                    if error != nil { RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.danger, lineWidth: 1.5) }
                }
            if let error {
                Text(error).font(Theme.body(12)).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("authField.error")
            } else if let hint {
                Text(hint).font(Theme.body(12)).foregroundStyle(Theme.textTertiary)
            }
        }
    }
}

/// A password box with the «show» eye. It shows what was typed on request, as the sign-in screen does.
struct PasswordInput: View {
    let placeholder: String
    @Binding var text: String
    var identifier: String
    var contentType: UITextContentType?
    @State private var shown = false

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if shown {
                    TextField(placeholder, text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
                } else {
                    SecureField(placeholder, text: $text)
                }
            }
            .textContentType(contentType)
            .accessibilityIdentifier(identifier)
            Button { shown.toggle() } label: {
                Image(systemName: shown ? "eye.slash" : "eye").foregroundStyle(Theme.textSecondary)
            }
            .accessibilityLabel(shown ? "Скрыть пароль" : "Показать пароль")
            .accessibilityIdentifier(identifier + ".toggle")
        }
    }
}

/// A message under a form: an error, a hint or a confirmation, in the site's tinted box.
struct AuthNotice: View {
    enum Kind { case danger, info, success }
    let kind: Kind
    let text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(Theme.body(14))
            .foregroundStyle(color)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint, in: RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var symbol: String {
        switch kind {
        case .danger: "exclamationmark.triangle"
        case .info: "info.circle"
        case .success: "checkmark.circle"
        }
    }
    private var color: Color { kind == .danger ? Theme.danger : (kind == .success ? Theme.success : Theme.text) }
    private var tint: Color { kind == .danger ? Theme.dangerTint : (kind == .success ? Theme.successTint : Theme.surfaceAlt) }
}

// MARK: - Sign up

/// «Создать аккаунт»: the role, the name, the address, the password and the boxes the role must tick. The server then sends a letter;
/// the person confirms the address there (the link opens the site) and signs in here.
struct RegisterView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    /// Called with the address when the person has confirmed it and wants to sign in.
    var onSignIn: (String) -> Void

    @State private var form = SignUpForm()
    @State private var errors: [SignUpForm.Field: String] = [:]
    @State private var missing: Set<String> = []
    @State private var formError: String?
    @State private var emailTaken = false
    @State private var working = false
    @State private var sentTo: String?
    @State private var forgotOpen = false
    @State private var document: LegalDocument?

    var body: some View {
        NavigationStack {
            Group {
                if let sentTo {
                    CheckEmailView(email: sentTo, onChangeEmail: { self.sentTo = nil }, onSignIn: { onSignIn(sentTo); dismiss() })
                } else {
                    formBody
                }
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("register.close") }
            }
        }
        .sheet(isPresented: $forgotOpen) { ForgotPasswordView(email: form.email) }
        .sheet(item: $document) { LegalPageSheet(document: $0) }
    }

    private var formBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Создать аккаунт")
                    .font(Theme.display(32, weight: .heavy, relativeTo: .largeTitle)).tracking(0.3).textCase(.uppercase)
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text("Выберите роль, заполните данные и отметьте согласия.")
                    .font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
                Text("Поля со звёздочкой (*) обязательны. Фамилия — по желанию.")
                    .font(Theme.body(12)).foregroundStyle(Theme.textTertiary)

                if let formError {
                    AuthNotice(kind: .danger, text: formError).accessibilityIdentifier("register.error")
                }
                roles
                AuthField(label: "Имя", required: true, error: errors[.firstName]) {
                    TextField("Имя", text: $form.firstName)
                        .textContentType(.givenName)
                        .onChange(of: form.firstName) { errors[.firstName] = nil }
                        .accessibilityIdentifier("register.firstName")
                }
                AuthField(label: "Фамилия") {
                    TextField("Фамилия", text: $form.lastName)
                        .textContentType(.familyName)
                        .accessibilityIdentifier("register.lastName")
                }
                AuthField(label: "Email", required: true, error: errors[.email]) {
                    TextField("name@example.com", text: $form.email)
                        .keyboardType(.emailAddress).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: form.email) { errors[.email] = nil; emailTaken = false }
                        .accessibilityIdentifier("register.email")
                }
                if emailTaken {
                    AuthNotice(kind: .info, text: "Этот адрес уже зарегистрирован. Войдите или восстановите пароль.")
                    HStack(spacing: 12) {
                        Button("Войти") { dismiss() }.accessibilityIdentifier("register.toLogin")
                        Button("Восстановить пароль") { forgotOpen = true }.accessibilityIdentifier("register.toForgot")
                    }
                    .font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.primary)
                }
                AuthField(label: "Пароль", required: true, error: errors[.password],
                          hint: "Минимум \(SignUpForm.minPasswordLength) символов. Подойдёт фраза из нескольких слов.") {
                    PasswordInput(placeholder: "Пароль", text: $form.password, identifier: "register.password", contentType: .newPassword)
                        .onChange(of: form.password) { errors[.password] = nil }
                }
                AuthField(label: "Повторите пароль", required: true, error: errors[.passwordConfirm]) {
                    PasswordInput(
                        placeholder: "Повторите пароль", text: $form.passwordConfirm, identifier: "register.passwordConfirm", contentType: .newPassword
                    )
                        .onChange(of: form.passwordConfirm) { errors[.passwordConfirm] = nil }
                }
                consents
                Button(action: submit) {
                    if working { ProgressView().tint(.white) } else { Text("Зарегистрироваться") }
                }
                .buttonStyle(.sag)
                .disabled(working)
                .padding(.top, 4)
                .accessibilityIdentifier("register.submit")
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: role

    private var roles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Кто вы? Роль выбирается один раз и потом не меняется")
                .font(Theme.body(13, weight: .semibold, relativeTo: .subheadline)).foregroundStyle(Theme.text)
            roleCard(.player, title: "Я игрок", hint: "Ищу тренера, веду тренировки и статистику", symbol: "person")
            roleCard(.coach, title: "Я тренер", hint: "Веду команды, публикую объявления и принимаю записи", symbol: "person.2")
            if let message = errors[.role] { Text(message).font(Theme.body(12)).foregroundStyle(Theme.danger) }
        }
    }

    private func roleCard(_ role: UserRole, title: String, hint: String, symbol: String) -> some View {
        let chosen = form.role == role
        return Button {
            form.choose(role)
            errors[.role] = nil
            missing = []
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Label(title, systemImage: symbol).font(Theme.display(17, relativeTo: .headline)).foregroundStyle(chosen ? Theme.primary : Theme.text)
                Text(hint).font(Theme.body(13)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(chosen ? Theme.primaryTint : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(chosen ? Theme.primary : Theme.borderStrong, lineWidth: chosen ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier("register.role.\(role.rawValue)")
    }

    // MARK: consents

    @ViewBuilder private var consents: some View {
        if let role = form.role {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(role.consentBoxes) { box in consentRow(box) }
            }
        } else {
            Text("Выберите роль — ниже появятся отметки, которые нужно поставить.")
                .font(Theme.body(13)).foregroundStyle(Theme.textTertiary)
        }
    }

    private func consentRow(_ box: ConsentBox) -> some View {
        let on = form.isAccepted(box)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                Button {
                    form.set(box, accepted: !on)
                    missing.remove(box.key)
                } label: {
                    Image(systemName: on ? "checkmark.square.fill" : "square")
                        .font(.system(size: 24)).foregroundStyle(on ? Theme.primary : Theme.textSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(box.lead)
                .accessibilityValue(on ? "Отмечено" : "Не отмечено")
                .accessibilityIdentifier("register.consent.\(box.key)")
                VStack(alignment: .leading, spacing: 4) {
                    Text(box.lead).font(Theme.body(13)).foregroundStyle(Theme.text)
                    ForEach(box.documents) { doc in
                        Button { document = doc } label: {
                            Text(doc.title).font(Theme.body(13, weight: .semibold)).foregroundStyle(Theme.primary).multilineTextAlignment(.leading)
                        }
                        .accessibilityIdentifier("register.doc.\(doc.key)")
                    }
                }
            }
            if missing.contains(box.key) {
                Text("Без этой отметки зарегистрироваться нельзя.").font(Theme.body(12)).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("register.consent.missing")
            }
        }
    }

    // MARK: submit

    private func submit() {
        formError = nil
        emailTaken = false
        errors = form.fieldErrors()
        missing = Set(form.missingConsents().map(\.key))
        guard errors.isEmpty, missing.isEmpty, let request = form.request() else { return }
        working = true
        Task {
            defer { working = false }
            do {
                _ = try await auth.register(request)
                sentTo = request.email
            } catch let error as APIError {
                if let field = SignUpForm.field(forServer: error.field) { errors[field] = error.message } else { formError = error.message }
                emailTaken = error.code == "email_taken"
            } catch {
                formError = APIError.unknown.message
            }
        }
    }
}
