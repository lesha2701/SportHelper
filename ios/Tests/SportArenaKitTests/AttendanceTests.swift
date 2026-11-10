import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let training = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let player = UUID(uuidString: "AAAAAAAA-2222-4333-8444-555555555555")!

private let attendanceJSON = """
[{"training_id":"11111111-2222-4333-8444-555555555555","user_id":"aaaaaaaa-2222-4333-8444-555555555555","first_name":"Игорь","last_name":"Орлов",
  "photo_url":null,"status":"absent","marked_by":null,"marked_at":"2026-11-03T18:30:00Z"},
 {"training_id":"11111111-2222-4333-8444-555555555555","user_id":"bbbbbbbb-2222-4333-8444-555555555555","first_name":"Анна","last_name":null,
  "photo_url":null,"status":"present","marked_by":null,"marked_at":"2026-11-03T18:30:00Z"}]
"""

struct AttendanceModelTests {
    private func decode() throws -> [Attendance] {
        try APIClient.decoder.decode([Attendance].self, from: Data(attendanceJSON.utf8))
    }

    @Test func theLinesAreReadWithTheirStatus() throws {
        let rows = try decode()
        #expect(rows.map(\.fullName) == ["Игорь Орлов", "Анна"])
        #expect(rows.map(\.status) == [.absent, .present])
    }

    @Test func aStatusThatIsNotKnownReadsAsPresent() throws {
        let row = try APIClient.decoder.decode(
            [Attendance].self, from: Data(attendanceJSON.replacingOccurrences(of: "\"absent\"", with: "\"late\"").utf8)
        )[0]
        #expect(row.status == .present)
    }

    @Test func theAbsenteesAndTheSummaryCountThePeople() throws {
        let rows = try decode()
        #expect(rows.absentees.map(\.fullName) == ["Игорь Орлов"])
        #expect(rows.summary == "Были 1 из 2")
    }

    @Test func aStatusFlipsToItsOpposite() {
        #expect(AttendanceStatus.present.flipped == .absent && AttendanceStatus.absent.flipped == .present)
        #expect(AttendanceStatus.absent.title == "Не был")
    }
}

struct AttendanceServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> TrainingsService {
        TrainingsService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    @Test func readingAsksTheTrainingsAttendance() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return (200, ["Content-Type": "application/json"], Data(attendanceJSON.utf8))
        }
        let rows = try await service.attendance(of: training)
        #expect(rows.count == 2)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "GET" && request.url?.path == "/api/trainings/11111111-2222-4333-8444-555555555555/attendance")
    }

    @Test func markingPatchesOnePersonWithTheStatusOnly() async throws {
        let seen = RequestLog()
        let one = """
        {"training_id":"11111111-2222-4333-8444-555555555555","user_id":"aaaaaaaa-2222-4333-8444-555555555555","first_name":"Игорь","last_name":null,
         "photo_url":null,"status":"absent","marked_by":"bbbbbbbb-2222-4333-8444-555555555555","marked_at":"2026-11-03T19:00:00Z"}
        """
        let service = make { request in
            seen.add(request)
            return (200, ["Content-Type": "application/json"], Data(one.utf8))
        }
        let row = try await service.setAttendance(.absent, of: player, at: training)
        #expect(row.status == .absent)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.path == "/api/trainings/11111111-2222-4333-8444-555555555555/attendance/aaaaaaaa-2222-4333-8444-555555555555")
        #expect(request.bodyJSON as? [String: String] == ["status": "absent"])
    }
}

struct AttendanceTaskTests {
    private func input(_ audience: TaskAudience) -> TaskInput? {
        TaskInput(
            title: "Догнать", description: "", deadline: nil, metricName: "", metricUnit: "", metricTarget: nil,
            requirements: TaskRequirements(), audience: audience, planId: nil, exerciseIds: []
        )
    }

    private func body(_ input: TaskInput) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(TaskCreateBody(input))) as? [String: Any])
    }

    @Test func aTaskForAbsenteesNeedsATrainingAndSendsIt() throws {
        #expect(input(.absentees(training: nil)) == nil)
        let sent = try body(try #require(input(.absentees(training: training))))
        #expect(sent["target_type"] as? String == "absentees" && sent["training_id"] as? String == training.uuidString)
        #expect((sent["player_ids"] as? [Any])?.isEmpty == true && sent["position"] == nil)
    }

    @Test func otherAudiencesSendNoTraining() throws {
        #expect(try body(try #require(input(.team)))["training_id"] == nil)
    }
}
