import UIKit

/// Prepares a picked photo for upload. The server takes JPEG, PNG, WebP and GIF - not the HEIC an iPhone camera produces - and
/// it shrinks pictures itself, but sending a 12-megapixel original over a mobile network is wasteful: scale to a sensible size first.
enum ImageEncoding {
    static func jpeg(from data: Data, maxSide: CGFloat = 2048, quality: CGFloat = 0.85) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        guard longest > maxSide else { return image.jpegData(compressionQuality: quality) }
        let scale = maxSide / longest
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let scaled = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return scaled.jpegData(compressionQuality: quality)
    }
}
