import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

private let playerJSON = """
{"user_id":"11111111-2222-4333-8444-555555555555","full_name":"Игорь Петров","age":21,"height_cm":180,"weight_kg":72.5,
 "sport":"Большой теннис","position":null,"level":"amateur","goals":"Выйти на турнир","load_restrictions":null,
 "created_at":"2026-11-04T10:00:00.123456Z","updated_at":"2026-11-04T10:00:00Z"}
"""
private let coachJSON = """
{"user_id":"11111111-2222-4333-8444-555555555555","full_name":"Анна Тренер","sport":"Большой теннис","experience_years":7,
 "specialization":"Техника подачи","description":null,"created_at":"2026-11-04T10:00:00Z","updated_at":"2026-11-04T10:00:00Z"}
"""

struct ProfileModelTests {
    @Test func aPlayerProfileIsReadWithItsOptionalFields() throws {
        let profile = try APIClient.decoder.decode(PlayerProfile.self, from: Data(playerJSON.utf8))
        #expect(profile.fullName == "Игорь Петров" && profile.age == 21 && profile.heightCm == 180 && profile.weightKg == 72.5)
        #expect(profile.position == nil && profile.loadRestrictions == nil && profile.goals == "Выйти на турнир")
        #expect(profile.skillLevel == .amateur && profile.skillLevel?.title == "Любитель")
    }

    @Test func aLevelThisVersionDoesNotKnowIsKeptNotFatal() throws {
        let text = playerJSON.replacingOccurrences(of: "amateur", with: "grandmaster")
        let profile = try APIClient.decoder.decode(PlayerProfile.self, from: Data(text.utf8))
        #expect(profile.level == "grandmaster" && profile.skillLevel == nil)
    }

    @Test func aNewAccountHasNeitherProfile() throws {
        let me = try APIClient.decoder.decode(ProfileMe.self, from: Data(#"{"active_mode":null,"player":null,"coach":null}"#.utf8))
        #expect(me.player == nil && me.coach == nil && me.activeMode == nil)
    }

    @Test func aCoachProfileIsRead() throws {
        let me = try APIClient.decoder.decode(ProfileMe.self, from: Data(#"{"active_mode":"coach","player":null,"coach":\#(coachJSON)}"#.utf8))
        #expect(me.coach?.experienceYears == 7 && me.coach?.specialization == "Техника подачи" && me.coach?.description == nil)
    }

    @Test func savingSendsTheServersFieldNamesAndLeavesOutWhatIsEmpty() throws {
        let input = PlayerProfileInput(fullName: "Игорь", sport: "Футбол", age: 20, heightCm: 180, loadRestrictions: "колено")
        let object = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(input)) as? [String: Any])
        #expect(object["full_name"] as? String == "Игорь" && object["height_cm"] as? Int == 180 && object["load_restrictions"] as? String == "колено")
        #expect(object["weight_kg"] == nil && object["position"] == nil)
    }

    @Test func editingStartsFromWhatIsSaved() throws {
        let profile = try APIClient.decoder.decode(PlayerProfile.self, from: Data(playerJSON.utf8))
        let input = PlayerProfileInput(profile)
        #expect(input.fullName == "Игорь Петров" && input.level == "amateur" && input.weightKg == 72.5)
        #expect(input.problem == nil)
    }

    @Test(arguments: [
        (PlayerProfileInput(fullName: "  ", sport: "Футбол"), "Укажите имя."),
        (PlayerProfileInput(fullName: "И", sport: ""), "Выберите вид спорта."),
        (PlayerProfileInput(fullName: "И", sport: "Футбол", age: 2), "Возраст — от 3 до 100 лет."),
        (PlayerProfileInput(fullName: "И", sport: "Футбол", age: 101), "Возраст — от 3 до 100 лет."),
        (PlayerProfileInput(fullName: "И", sport: "Футбол", heightCm: 49), "Рост — от 50 до 260 см."),
        (PlayerProfileInput(fullName: "И", sport: "Футбол", weightKg: 14.9), "Вес — от 15 до 300 кг."),
        (PlayerProfileInput(fullName: String(repeating: "я", count: 101), sport: "Футбол"), "Имя — не длиннее 100 символов."),
        (PlayerProfileInput(fullName: "И", sport: "Футбол", goals: String(repeating: "я", count: 1001)), "Текст — не длиннее 1000 символов."),
    ])
    func aPlayerProfileOutsideTheServersLimitsIsRefusedBeforeSending(input: PlayerProfileInput, message: String) {
        #expect(input.problem == message)
    }

    @Test func theLimitsThemselvesAreAccepted() {
        #expect(PlayerProfileInput(fullName: "И", sport: "Футбол", age: 3, heightCm: 50, weightKg: 15).problem == nil)
        #expect(PlayerProfileInput(fullName: "И", sport: "Футбол", age: 100, heightCm: 260, weightKg: 300).problem == nil)
    }

    @Test(arguments: [
        (CoachProfileInput(fullName: "", sport: "Футбол"), "Укажите имя."),
        (CoachProfileInput(fullName: "А", sport: "Футбол", experienceYears: -1), "Опыт — от 0 до 80 лет."),
        (CoachProfileInput(fullName: "А", sport: "Футбол", experienceYears: 81), "Опыт — от 0 до 80 лет."),
        (CoachProfileInput(fullName: "А", sport: "Футбол", specialization: String(repeating: "я", count: 201)), "Специализация — не длиннее 200 символов."),
    ])
    func aCoachProfileOutsideTheServersLimitsIsRefusedBeforeSending(input: CoachProfileInput, message: String) {
        #expect(input.problem == message)
    }

    @Test(arguments: [(0, "0 лет"), (1, "1 год"), (2, "2 года"), (4, "4 года"), (5, "5 лет"), (11, "11 лет"), (12, "12 лет"),
                      (14, "14 лет"), (21, "21 год"), (22, "22 года"), (25, "25 лет"), (101, "101 год"), (111, "111 лет")])
    func yearsAgreeWithTheNumberInRussian(n: Int, text: String) {
        #expect(Russian.years(n) == text)
    }
}

struct ProfileServiceTests {
    private func service(_ handler: @escaping MockServer.Handler) -> (ProfileService, APIClient) {
        let api = APIClient(baseURL: base, session: MockServer.session(handler))
        return (ProfileService(client: api), api)
    }

    @Test func theProfileIsFetched() async throws {
        let (profiles, _) = service { request in
            #expect(request.url?.path == "/api/profile/me")
            return json(#"{"active_mode":"player","player":\#(playerJSON),"coach":null}"#)
        }
        let me = try await profiles.me()
        #expect(me.player?.sport == "Большой теннис" && me.coach == nil)
    }

    @Test func anAdministratorSwitchesTheirWorkingModeAndTheNewModeIsReturned() async throws {
        let seen = RequestLog()
        let (profiles, api) = service { request in seen.add(request); return json(#"{"active_mode":"player","player":\#(playerJSON),"coach":\#(coachJSON)}"#) }
        await api.setCSRFToken("csrf-1")

        let me = try await profiles.switchMode(to: "player")

        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/profile/active-mode")
        #expect(request.bodyJSON?["mode"] as? String == "player" && request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-1")
        #expect(me.activeMode == "player" && me.player != nil && me.coach != nil)
    }

    @Test func savingAPlayerProfileUsesPutWithTheTokenAndReturnsTheSavedOne() async throws {
        let seen = RequestLog()
        let (profiles, api) = service { request in seen.add(request); return json(playerJSON) }
        await api.setCSRFToken("csrf-1")

        let saved = try await profiles.savePlayer(PlayerProfileInput(fullName: "Игорь Петров", sport: "Большой теннис", age: 21))

        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/profile/player")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-1")
        #expect(request.bodyJSON?["full_name"] as? String == "Игорь Петров")
        #expect(saved.age == 21)
    }

    @Test func aServerRefusalOfAFieldComesBackWithTheFieldName() async {
        let (profiles, _) = service { _ in
            json(#"{"error":{"code":"validation_error","message":"Возраст — от 3 до 100 лет.","field":"age"}}"#, status: 422)
        }
        do {
            _ = try await profiles.savePlayer(PlayerProfileInput(fullName: "И", sport: "Футбол", age: 150))
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.field == "age" && error.status == 422)
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func savingACoachProfileUsesTheCoachEndpoint() async throws {
        let seen = RequestLog()
        let (profiles, _) = service { request in seen.add(request); return json(coachJSON) }
        let saved = try await profiles.saveCoach(CoachProfileInput(fullName: "Анна Тренер", sport: "Большой теннис", experienceYears: 7))
        #expect(seen.all.first?.url?.path == "/api/profile/coach" && saved.experienceYears == 7)
    }

    @Test func anAvatarIsUploadedAsAMultipartFormWithTheFileAndTheToken() async throws {
        let seen = RequestLog()
        let (profiles, api) = service { request in
            seen.add(request)
            return json(#"{"id":"11111111-2222-4333-8444-555555555555","first_name":"Анна","last_name":null,"avatar_file_id":"99999999-2222-4333-8444-555555555555"}"#)
        }
        await api.setCSRFToken("csrf-2")
        let picture = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])

        let user = try await profiles.uploadAvatar(data: picture, filename: "me\".jpg")

        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/users/me/avatar")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-2")
        let contentType = try #require(request.value(forHTTPHeaderField: "Content-Type"))
        #expect(contentType.hasPrefix("multipart/form-data; boundary=Boundary-"))
        let boundary = String(contentType.dropFirst("multipart/form-data; boundary=".count))
        let body = try #require(request.bodyData)
        // the body holds JPEG bytes, which are not valid UTF-8: the lossy decoding is what is wanted here
        // swiftlint:disable:next optional_data_string_conversion
        let text = String(decoding: body, as: UTF8.self)
        #expect(text.hasPrefix("--\(boundary)\r\n") && text.hasSuffix("\r\n--\(boundary)--\r\n"))
        #expect(text.contains(#"name="file"; filename="me_.jpg""#))  // a quote in a file name cannot break out of the header
        #expect(text.contains("Content-Type: image/jpeg"))
        #expect(body.range(of: picture) != nil)  // the bytes are in the body untouched
        #expect(user.avatarFileId == UUID(uuidString: "99999999-2222-4333-8444-555555555555"))
    }

    @Test func removingTheAvatarIsADeleteWithTheToken() async throws {
        let seen = RequestLog()
        let (profiles, api) = service { request in
            seen.add(request)
            return json(#"{"id":"11111111-2222-4333-8444-555555555555","first_name":"Анна","last_name":null,"avatar_file_id":null}"#)
        }
        await api.setCSRFToken("csrf-3")
        let user = try await profiles.removeAvatar()
        #expect(seen.all.first?.httpMethod == "DELETE" && seen.all.first?.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-3")
        #expect(user.avatarFileId == nil)
    }

    @Test func aPictureIsFetchedAsRawBytesAndTheSmallCopyIsAskedFor() async throws {
        let seen = RequestLog()
        let bytes = Data([1, 2, 3, 4, 5])
        let (profiles, _) = service { request in seen.add(request); return (200, ["Content-Type": "image/webp"], bytes) }
        let id = UUID()

        let small = try await profiles.fileData(id: id)
        let full = try await profiles.fileData(id: id, thumbnail: false)

        #expect(small == bytes && full == bytes)
        #expect(seen.all[0].url?.absoluteString == "https://sportarenaglobal.ru/api/files/\(id.uuidString.lowercased())?size=thumb")
        #expect(seen.all[1].url?.query == nil)
    }

    @Test func aMissingPictureIsAnErrorNotEmptyBytes() async {
        let (profiles, _) = service { _ in json(#"{"error":{"code":"not_found","message":"Файл не найден."}}"#, status: 404) }
        await #expect(throws: APIError.self) { try await profiles.fileData(id: UUID()) }
    }
}

struct AccountDeletionTests {
    @Test func deletingTheAccountAsksForThePasswordAndReturnsTheServersExplanation() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request)
            return json(#"{"message":"Запрос принят. Аккаунт будет удалён через 30 дн."}"#)
        })
        await api.setCSRFToken("csrf-4")

        let message = try await AuthService(client: api).requestAccountDeletion(password: "my password")

        #expect(message.contains("30 дн"))
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/auth/account/delete" && request.bodyJSON?["password"] as? String == "my password")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-4")
    }

    @Test func aWrongPasswordDoesNotDeleteAnything() async {
        let api = APIClient(baseURL: base, session: MockServer.session { _ in
            json(#"{"error":{"code":"invalid_password","message":"Неверный пароль.","field":"password"}}"#, status: 403)
        })
        do {
            _ = try await AuthService(client: api).requestAccountDeletion(password: "nope")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "invalid_password" && error.field == "password")
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func theDeletionCanBeCancelled() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in seen.add(request); return json(#"{"message":"ok"}"#) })
        try await AuthService(client: api).cancelAccountDeletion()
        #expect(seen.all.first?.url?.path == "/api/auth/account/delete/cancel" && seen.all.first?.httpMethod == "POST")
    }
}
