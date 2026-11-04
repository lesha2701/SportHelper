import Foundation
import Security
import SportArenaKit

/// One small secret in the iOS Keychain. Readable only on this device and only after the first unlock since boot, so the
/// session is available when the app is opened from a notification, but never leaves the phone with a backup.
struct KeychainSecretStore: SecretStore {
    let service: String
    let account: String

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func read() -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    func write(_ data: Data) throws {
        delete()
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
