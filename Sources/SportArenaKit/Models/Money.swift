import Foundation

/// A price as the server sends it (`2500.00` rubles). Decimal, never a floating point number: money must not drift.
public enum Money {
    /// "2 500 ₽" (whole rubles without kopecks, otherwise with them). `currency` is the ISO code the server sends.
    public static func format(_ amount: Decimal, currency: String = "RUB") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.currencyCode = currency
        var rounded = amount
        var source = amount
        NSDecimalRound(&rounded, &source, 2, .plain)
        let whole = rounded == Decimal(Int(truncating: NSDecimalNumber(decimal: rounded)))
        formatter.minimumFractionDigits = whole ? 0 : 2
        formatter.maximumFractionDigits = whole ? 0 : 2
        return formatter.string(from: rounded as NSDecimalNumber) ?? "\(amount) \(currency)"
    }
}
