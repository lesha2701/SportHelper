import Foundation

/// The text of one legal document as the site keeps it (`frontend/src/legal/data/<key>.json`): plain runs of text, never HTML.
/// The app carries a copy of these files (`App/Resources/Legal`, refreshed by `scripts/sync-legal.sh`), so a document can be read
/// in the app, offline, exactly in the edition the sign-up form reports as accepted. A test compares the copy with the site's files.
public struct LegalText: Decodable, Equatable, Sendable {
    public struct Run: Decodable, Equatable, Sendable {
        public let text: String
        public let bold: Bool
        public let italic: Bool
        public let href: String?

        private enum CodingKeys: String, CodingKey { case t, b, i, href }

        public init(text: String, bold: Bool = false, italic: Bool = false, href: String? = nil) {
            self.text = text
            self.bold = bold
            self.italic = italic
            self.href = href
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            text = try container.decode(String.self, forKey: .t)
            bold = try container.decodeIfPresent(Bool.self, forKey: .b) ?? false
            italic = try container.decodeIfPresent(Bool.self, forKey: .i) ?? false
            href = try container.decodeIfPresent(String.self, forKey: .href)
        }
    }

    public enum Block: Decodable, Equatable, Sendable {
        case heading(level: Int, runs: [Run], centered: Bool)
        case paragraph(runs: [Run], centered: Bool)
        /// A bulleted (`ordered == false`) or numbered list; each item is one line of runs.
        case list(ordered: Bool, items: [[Run]])
        /// The first row is the header; a cell holds paragraphs, a paragraph holds runs.
        case table(rows: [[[[Run]]]])

        private enum CodingKeys: String, CodingKey { case type, runs, items, rows, center, align }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let type = try container.decode(String.self, forKey: .type)
            let centerFlag = try container.decodeIfPresent(Bool.self, forKey: .center) ?? false
            let align = try container.decodeIfPresent(String.self, forKey: .align)
            let centered = centerFlag || align == "center"
            switch type {
            case "h1", "h2":
                self = .heading(level: type == "h1" ? 1 : 2, runs: try container.decode([Run].self, forKey: .runs), centered: centered)
            case "p":
                self = .paragraph(runs: try container.decode([Run].self, forKey: .runs), centered: centered)
            case "ul", "ol":
                self = .list(ordered: type == "ol", items: try container.decode([[Run]].self, forKey: .items))
            case "table":
                self = .table(rows: try container.decode([[[[Run]]]].self, forKey: .rows))
            default:
                throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown block type \(type)")
            }
        }
    }

    public let key: String
    public let title: String
    /// The edition, YYYY-MM-DD: the one the sign-up form reports.
    public let version: String
    public let blocks: [Block]

    public init(key: String, title: String, version: String, blocks: [Block]) {
        self.key = key
        self.title = title
        self.version = version
        self.blocks = blocks
    }

    public static func decode(_ data: Data) throws -> LegalText {
        try JSONDecoder().decode(LegalText.self, from: data)
    }
}

public extension Array where Element == LegalText.Run {
    /// The runs as one string (for tests and accessibility).
    var plainText: String { map(\.text).joined() }
}

public extension LegalDocument {
    /// «Редакция от 20.10.2026» from the edition `YYYY-MM-DD`.
    var editionText: String {
        let parts = version.split(separator: "-")
        guard parts.count == 3 else { return version }
        return "Редакция от \(parts[2]).\(parts[1]).\(parts[0])"
    }
}
