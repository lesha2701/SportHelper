import XCTest
@testable import SportArena

final class AppEnvironmentTests: XCTestCase {
    func testTheServerAddressComesFromTheBuildConfiguration() {
        // Debug builds point at the server on this Mac, Release builds at the real site (project.yml: API_BASE_URL).
        let url = AppEnvironment.current.baseURL
        XCTAssertTrue(url.absoluteString == "http://localhost:8010" || url.absoluteString == "https://sportarenaglobal.ru", "unexpected \(url)")
    }
}
