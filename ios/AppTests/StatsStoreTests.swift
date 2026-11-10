import SportArenaKit
import XCTest
@testable import SportArena

final class StatsStoreTests: XCTestCase {
    private func error(_ code: String, _ message: String, status: Int = 400) -> APIError { APIError(status: status, code: code, message: message) }

    func testServerTextsAreSaidInRussian() {
        XCTAssertEqual(StatsStore.russian(error("forbidden", "only the head coach or an assistant coach can view team statistics", status: 403)).message,
                       "Статистика команды доступна тренерскому составу.")
        XCTAssertEqual(StatsStore.russian(error("forbidden", "you do not have access to this player's statistics", status: 403)).message,
                       "Нет доступа к данным этого игрока.")
        XCTAssertEqual(StatsStore.russian(error("not_found", "metric not found", status: 404)).message, "Показатель не найден: возможно, его уже удалили.")
        XCTAssertTrue(StatsStore.russian(error("player_profile_required", "create a player profile", status: 409)).message.contains("профилем игрока"))
    }

    func testTheNameOfAServerSettingIsNeverShown() {
        let leaked = error("ai_unavailable", "ИИ не настроен на сервере (нет YANDEX_AI_API_KEY/YANDEX_AI_FOLDER_ID)", status: 502)
        XCTAssertFalse(StatsStore.russian(leaked).message.contains("YANDEX"))
    }

    func testAnOrdinaryAIFailureKeepsTheServersOwnRussianText() {
        let busy = error("ai_unavailable", "ИИ временно недоступен, попробуйте ещё раз позже", status: 502)
        XCTAssertEqual(StatsStore.russian(busy).message, busy.message)
    }

    func testTheCodeSurvivesTranslation() {
        XCTAssertEqual(StatsStore.russian(error("not_found", "metric not found", status: 404)).code, "not_found")
    }
}
