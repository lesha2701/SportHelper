import Foundation

/// What the server says about this version of the app (`GET /api/app-config`, no sign-in needed; docs/mobile.md).
public struct AppConfig: Decodable, Equatable, Sendable {
    public struct Policy: Decodable, Equatable, Sendable {
        public let minVersion: String?
        public let latestVersion: String?
        public let updateUrl: String?
    }

    /// The server's answer about this very app: present because the app says who it is in every request.
    public struct Client: Decodable, Equatable, Sendable {
        public let platform: String
        public let version: String?
        /// The server will refuse this version: nothing works until the app is updated.
        public let updateRequired: Bool
        /// A newer version exists; offering it is up to the app.
        public let updateAvailable: Bool
    }

    public struct Platforms: Decodable, Equatable, Sendable {
        public let ios: Policy
        public let android: Policy
    }

    public let apiVersion: Int
    public let platforms: Platforms
    public let client: Client?

    /// Where to send the person to update (the App Store link the server knows), or nil when it has none.
    public var updateURL: URL? {
        guard let text = platforms.ios.updateUrl, let url = URL(string: text), url.scheme == "https" else { return nil }
        return url
    }
}

/// Why the app asks to be updated.
public struct UpdateNotice: Equatable, Sendable {
    public let minVersion: String?
    public let url: URL?
    /// true: the server refuses this version. false: just a newer version to offer.
    public let isRequired: Bool

    public init(minVersion: String?, url: URL?, isRequired: Bool) {
        self.minVersion = minVersion
        self.url = url
        self.isRequired = isRequired
    }

    /// From the answer of `app-config`: nil when this version is current.
    public init?(_ config: AppConfig) {
        guard let client = config.client, client.updateRequired || client.updateAvailable else { return nil }
        self.init(minVersion: config.platforms.ios.minVersion, url: config.updateURL, isRequired: client.updateRequired)
    }

    /// From a refusal (HTTP 426): always required.
    public init?(_ error: APIError) {
        guard error.isUpdateRequired else { return nil }
        self.init(minVersion: error.minVersion, url: error.updateURL.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }, isRequired: true)
    }
}
