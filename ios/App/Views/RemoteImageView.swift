import SwiftUI

/// A picture the server keeps (a listing's photo), loaded with the person's session and cached in memory.
struct RemoteImageView: View {
    let fileId: UUID?
    var contentMode: ContentMode = .fill

    @Environment(AuthStore.self) private var auth
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Rectangle().fill(Theme.primary.opacity(0.08))
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Image(systemName: "figure.tennis").font(.largeTitle).foregroundStyle(Theme.primary.opacity(0.4))
            }
        }
        .clipped()
        .accessibilityHidden(true)
        .task(id: fileId) {
            image = nil
            guard let fileId else { return }
            image = await auth.profile.image(for: fileId)
        }
    }
}
