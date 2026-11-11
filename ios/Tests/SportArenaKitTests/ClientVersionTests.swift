import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

/// The server may refuse an app that is too old (docs/mobile.md, «Минимальная версия приложения»).
struct ClientVersionTests {
    private final class Box<T: Sendable>: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [T] = []
        func add(_ item: T) { lock.lock(); items.append(item); lock.unlock() }
        var all: [T] { lock.lock(); defer { lock.unlock() }; return items }
    }

    // MARK: who the app says it is

    @Test func everyRequestSaysItIsTheIPhoneAppAndWhichVersion() async throws {
        let seen = Box<[String: String]>()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request.allHTTPHeaderFields ?? [:])
            return json(#"{"message":"ok"}"#)
        }, version: "1.4.0")
        let _: MessageResponse = try await api.send(.get, "/api/x")
        let _: MessageResponse = try await api.send(.post, "/api/y", body: ["a": "b"])
        for headers in seen.all {
            #expect(headers["X-Client-Platform"] == "ios" && headers["X-Client-Version"] == "1.4.0")
        }
        #expect(seen.all.count == 2)
    }

    @Test func aVersionThatIsNotDottedNumbersIsNotSent() async throws {
        for bad in [nil, "", "1.4-beta", "v1.4", "1.4.x", "1.2.3.4.5"] as [String?] {
            let seen = Box<[String: String]>()
            let api = APIClient(baseURL: base, session: MockServer.session { request in
                seen.add(request.allHTTPHeaderFields ?? [:])
                return json(#"{"message":"ok"}"#)
            }, version: bad)
            let _: MessageResponse = try await api.send(.get, "/api/x")
            #expect(seen.all.first?["X-Client-Version"] == nil, "\(String(describing: bad))")
            #expect(seen.all.first?["X-Client-Platform"] == "ios")  // the platform is always said
        }
        #expect(APIClient.versionForServer(" 2.10 ") == "2.10")
    }

    // MARK: the refusal

    private let refusal = #"{"error":{"code":"client_update_required","message":"Эта версия приложения больше не поддерживается. Обновите приложение.","min_version":"1.4.0","update_url":"https://apps.apple.com/app/id1"}}"#

    @Test func a426BecomesAnUpdateRequiredErrorWithTheMinimumAndTheLink() async {
        let api = APIClient(baseURL: base, session: MockServer.session { _ in json(self.refusal, status: 426) }, version: "1.3.0")
        do {
            let _: MessageResponse = try await api.send(.get, "/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.isUpdateRequired && error.minVersion == "1.4.0" && error.updateURL == "https://apps.apple.com/app/id1")
            #expect(error.message.contains("Обновите приложение"))
            let notice = UpdateNotice(error)
            #expect(notice == UpdateNotice(minVersion: "1.4.0", url: URL(string: "https://apps.apple.com/app/id1"), isRequired: true))
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func theAppIsToldOnTheRefusalSoAnyScreenCanBeReplacedByTheUpdateScreen() async {
        let told = Box<APIError>()
        let api = APIClient(baseURL: base, session: MockServer.session { _ in json(self.refusal, status: 426) },
                            onUpdateRequired: { told.add($0) }, version: "1.3.0")
        _ = try? await api.send(.get, "/api/a") as MessageResponse
        _ = try? await api.send(.post, "/api/b", body: ["x": "y"]) as MessageResponse
        #expect(told.all.count == 2 && told.all.allSatisfy { $0.isUpdateRequired })
    }

    @Test func otherErrorsDoNotAskForAnUpdate() async {
        let told = Box<APIError>()
        for status in [401, 403, 404, 429, 500] {
            let api = APIClient(baseURL: base, session: MockServer.session { _ in json(#"{"error":{"code":"x","message":"m"}}"#, status: status) },
                                onUpdateRequired: { told.add($0) })
            _ = try? await api.send(.get, "/api/a") as MessageResponse
        }
        // a 426 of anything but the server's own refusal (a proxy's, say) is not an instruction to update
        let proxy = APIClient(baseURL: base, session: MockServer.session { _ in json(#"{"error":{"code":"upgrade","message":"m"}}"#, status: 426) },
                              onUpdateRequired: { told.add($0) })
        _ = try? await proxy.send(.get, "/api/a") as MessageResponse
        #expect(told.all.isEmpty)
        #expect(UpdateNotice(APIError(status: 403, code: "client_update_required", message: "m")) == nil)
    }

    @Test func aLinkThatIsNotHTTPSIsNeverFollowed() {
        let error = APIError(status: 426, code: "client_update_required", message: "m", minVersion: "2.0", updateURL: "itms-services://?action=download-manifest")
        #expect(UpdateNotice(error)?.url == nil && UpdateNotice(error)?.isRequired == true)
    }

    // MARK: app-config

    @Test func appConfigTellsWhetherThisVersionMustOrMayUpdate() async throws {
        let body = #"""
        {"api_version":1,"platforms":{"ios":{"min_version":"1.4.0","latest_version":"1.6.0","update_url":"https://apps.apple.com/app/id1"},
        "android":{"min_version":null,"latest_version":null,"update_url":null}},
        "client":{"platform":"ios","version":"1.3.0","update_required":true,"update_available":true}}
        """#
        let service = AuthService(client: APIClient(baseURL: base, session: MockServer.session { request in
            #expect(request.url?.path == "/api/app-config")
            return json(body)
        }, version: "1.3.0"))
        let config = try await service.appConfig()
        #expect(config.apiVersion == 1 && config.platforms.ios.minVersion == "1.4.0" && config.platforms.android.minVersion == nil)
        #expect(config.updateURL == URL(string: "https://apps.apple.com/app/id1"))
        #expect(UpdateNotice(config) == UpdateNotice(minVersion: "1.4.0", url: URL(string: "https://apps.apple.com/app/id1"), isRequired: true))
    }

    @Test func aCurrentVersionHasNoNoticeAndANewerOneIsOnlyOffered() throws {
        func config(required: Bool, available: Bool, client: Bool = true) throws -> AppConfig {
            let clientJSON = client ? #","client":{"platform":"ios","version":"1.5.0","update_required":\#(required),"update_available":\#(available)}"# : ""
            let text = #"{"api_version":1,"platforms":{"ios":{"min_version":"1.0.0","latest_version":"1.6.0","update_url":null},"android":{"min_version":null,"latest_version":null,"update_url":null}}\#(clientJSON)}"#
            return try APIClient.decoder.decode(AppConfig.self, from: Data(text.utf8))
        }
        #expect(UpdateNotice(try config(required: false, available: false)) == nil)
        let offered = UpdateNotice(try config(required: false, available: true))
        #expect(offered?.isRequired == false && offered?.url == nil)
        #expect(UpdateNotice(try config(required: false, available: false, client: false)) == nil)  // the server did not know who asked
    }
}
