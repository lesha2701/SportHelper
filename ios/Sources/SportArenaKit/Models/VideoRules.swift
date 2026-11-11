import Foundation

/// What the server takes as a video, so the person is told before a long upload and not after it.
public enum VideoRules {
    /// The site's limit for every video (MAX_VIDEO_SIZE_MB).
    public static let maxBytes = 100 * 1024 * 1024
    /// The site's limit for the video of an exercise (MAX_VIDEO_DURATION_SECONDS); a video handed in with a task has none.
    public static let maxExerciseSeconds = 60
    /// The site's limit for a video of the gallery of achievements: the same setting as for an exercise.
    public static let maxAchievementSeconds = 60
    /// What a video is sent as: the app always makes an MP4 of the picked video.
    public static let mimeType = "video/mp4"

    /// A sentence saying what is wrong with the video, or nil when the server will take it. `limitSeconds` is nil where there is no limit.
    public static func problem(bytes: Int, seconds: Double?, limitSeconds: Int?) -> String? {
        if bytes <= 0 { return "Не удалось прочитать видео." }
        if bytes > maxBytes { return "Видео больше \(maxBytes / 1024 / 1024) МБ: выберите короче или снимите в меньшем качестве." }
        if let limitSeconds, let seconds, seconds > Double(limitSeconds) {
            return "Видео длиннее \(limitSeconds) секунд (сейчас \(Int(seconds.rounded(.up)))): выберите покороче."
        }
        return nil
    }

    /// "0:12 · 8,4 МБ".
    public static func summary(bytes: Int, seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let clock = "\(total / 60):" + String(format: "%02d", total % 60)
        let megabytes = Double(bytes) / 1024 / 1024
        let size = megabytes >= 10 ? String(Int(megabytes.rounded())) : String(format: "%.1f", megabytes).replacingOccurrences(of: ".", with: ",")
        return "\(clock) · \(size) МБ"
    }

    /// The server's words for a refused video, in the app's own (the server says some of them in English).
    public static func russian(code: String?) -> String? {
        switch code {
        case "unsupported_media_type": "Такой файл не подходит: нужно видео (MP4, MOV или WebM)."
        case "file_too_large": "Видео слишком большое: не больше \(maxBytes / 1024 / 1024) МБ."
        case "video_too_long": "Видео слишком длинное: не больше \(maxAchievementSeconds) секунд."
        case "invalid_video": "Не удалось прочитать это видео. Выберите другое."
        default: nil
        }
    }
}
