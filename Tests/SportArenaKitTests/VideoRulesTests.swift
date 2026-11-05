import Foundation
import Testing
@testable import SportArenaKit

struct VideoRulesTests {
    @Test func aVideoWithinTheLimitsIsTaken() {
        #expect(VideoRules.problem(bytes: 20 * 1024 * 1024, seconds: 45, limitSeconds: 60) == nil)
        #expect(VideoRules.problem(bytes: VideoRules.maxBytes, seconds: 60, limitSeconds: 60) == nil)
    }

    @Test func aTooBigOrEmptyVideoIsNamed() {
        #expect(VideoRules.problem(bytes: VideoRules.maxBytes + 1, seconds: 10, limitSeconds: nil)?.contains("100 МБ") == true)
        #expect(VideoRules.problem(bytes: 0, seconds: 10, limitSeconds: nil) != nil)
    }

    @Test func theLengthIsCheckedOnlyWhereThereIsALimit() {
        #expect(VideoRules.problem(bytes: 1024, seconds: 61, limitSeconds: 60)?.contains("60 секунд") == true)
        #expect(VideoRules.problem(bytes: 1024, seconds: 600, limitSeconds: nil) == nil, "a task video has no length limit")
        #expect(VideoRules.problem(bytes: 1024, seconds: nil, limitSeconds: 60) == nil)
    }

    @Test func theSummaryShowsTimeAndSize() {
        #expect(VideoRules.summary(bytes: 8_800_000, seconds: 12) == "0:12 · 8,4 МБ")
        #expect(VideoRules.summary(bytes: 25 * 1024 * 1024, seconds: 75) == "1:15 · 25 МБ")
    }

    @Test func theServersRefusalsAreSaidInRussian() {
        #expect(VideoRules.russian(code: "unsupported_media_type")?.contains("видео") == true)
        #expect(VideoRules.russian(code: "file_too_large")?.contains("100") == true)
        #expect(VideoRules.russian(code: "storage_error") == nil)
    }
}
