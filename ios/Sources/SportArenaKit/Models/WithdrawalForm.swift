import Foundation

/// How a coach wants the money sent. Never a card: the server refuses a card number in every field and so does the form.
public enum PayoutMethod: String, CaseIterable, Identifiable, Sendable {
    case sbp
    case bankTransfer = "bank_transfer"

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .sbp: "СБП по номеру телефона"
        case .bankTransfer: "Банковский перевод по реквизитам"
        }
    }
}

/// The body of `POST /api/finance/withdrawals`. `clientKey` makes a second send of the same form harmless: the server answers with the
/// first request instead of creating another one.
struct WithdrawalRequest: Encodable, Sendable {
    let amountKopecks: Int
    let method: String
    let details: [String: String]
    let clientKey: UUID
    let password: String
}

/// The «Вывести средства» form: what the person typed, checked before it is sent. The server checks everything again and is the
/// last word (the balance, the minimum, the password, the details); this only saves a round trip for the obvious mistakes.
public struct WithdrawalForm: Equatable, Sendable {
    public enum Field: String, Sendable { case amount, method, recipient, bank, phone, bik, account, inn, password }

    public var amountText = ""
    public var method: PayoutMethod = .sbp
    public var recipient = ""
    public var bank = ""
    public var phone = ""
    public var bik = ""
    public var account = ""
    public var inn = ""
    public var password = ""
    /// One per form: sending it again after a lost answer must not create a second request.
    public let clientKey: UUID

    public init(clientKey: UUID = UUID()) { self.clientKey = clientKey }

    /// «1 500,50» or «1500.5» → 150050 kopecks. Nil for anything that is not an amount of at most two decimals (never a float).
    public static func kopecks(from text: String) -> Int? {
        let cleaned = text.filter { !$0.isWhitespace }.replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, cleaned.count <= 12 else { return nil }
        let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, let whole = parts.first, !whole.isEmpty, whole.allSatisfy(\.isASCIIDigit) else { return nil }
        var fraction = parts.count == 2 ? String(parts[1]) : ""
        guard fraction.count <= 2, fraction.allSatisfy(\.isASCIIDigit) else { return nil }
        fraction += String(repeating: "0", count: 2 - fraction.count)
        guard let rubles = Int(whole), let cents = Int(fraction) else { return nil }
        return rubles * 100 + cents
    }

    /// What is wrong with the form, by field (empty = it can be sent). `availableKopecks` and `minimumKopecks` come from the summary.
    public func problems(availableKopecks: Int, minimumKopecks: Int) -> [Field: String] {
        var found: [Field: String] = [:]
        if let amount = Self.kopecks(from: amountText), amount > 0 {
            if amount < minimumKopecks {
                found[.amount] = "Минимальная сумма вывода — \(Money.kopecks(minimumKopecks))."
            } else if amount > availableKopecks {
                found[.amount] = "Недостаточно доступных средств: \(Money.kopecks(availableKopecks))."
            }
        } else {
            found[.amount] = "Введите сумму в рублях, например 15000 или 15000,50."
        }
        if Self.collapsed(recipient).count < 3 { found[.recipient] = "Укажите получателя (ФИО или название) — не короче трёх символов." }
        if Self.collapsed(bank).count < 2 { found[.bank] = "Укажите банк." }
        switch method {
        case .sbp:
            if Self.normalizedPhone(phone) == nil { found[.phone] = "Номер телефона должен быть российским мобильным: +7 9XX XXX-XX-XX." }
        case .bankTransfer:
            if !Self.digits(bik, count: 9) { found[.bik] = "БИК — 9 цифр." }
            if !Self.digits(account, count: 20) { found[.account] = "Расчётный счёт — 20 цифр." }
            let tax = inn.filter { !$0.isWhitespace }
            if !tax.isEmpty && !(Self.digits(tax, count: 10) || Self.digits(tax, count: 12)) { found[.inn] = "ИНН — 10 или 12 цифр." }
        }
        if password.isEmpty { found[.password] = "Введите пароль от аккаунта." }
        return found
    }

    /// The request to send, or nil while `problems` is not empty.
    func request(availableKopecks: Int, minimumKopecks: Int) -> WithdrawalRequest? {
        guard problems(availableKopecks: availableKopecks, minimumKopecks: minimumKopecks).isEmpty, let amount = Self.kopecks(from: amountText) else { return nil }
        var details = ["recipient": Self.collapsed(recipient), "bank": Self.collapsed(bank)]
        switch method {
        case .sbp:
            details["phone"] = Self.normalizedPhone(phone)
        case .bankTransfer:
            details["bik"] = bik.filter { !$0.isWhitespace }
            details["account"] = account.filter { !$0.isWhitespace }
            let tax = inn.filter { !$0.isWhitespace }
            if !tax.isEmpty { details["inn"] = tax }
        }
        return WithdrawalRequest(amountKopecks: amount, method: method.rawValue, details: details, clientKey: clientKey, password: password)
    }

    /// «+7 912 345-67-89», «89123456789», «9123456789» → «+79123456789»; nil when it is not a Russian mobile number.
    static func normalizedPhone(_ text: String) -> String? {
        var digits = text.filter(\.isASCIIDigit)
        if digits.count == 11, digits.first == "7" || digits.first == "8" { digits.removeFirst() }
        guard digits.count == 10, digits.first == "9" else { return nil }
        return "+7" + digits
    }

    private static func collapsed(_ text: String) -> String { text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
    private static func digits(_ text: String, count: Int) -> Bool {
        let value = text.filter { !$0.isWhitespace }
        return value.count == count && value.allSatisfy(\.isASCIIDigit)
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
