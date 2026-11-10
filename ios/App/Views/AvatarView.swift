import SwiftUI

/// A round avatar: the person's picture, or their initial while there is none (or it has not loaded yet).
struct AvatarView: View {
    let store: ProfileStore
    let fileId: UUID?
    let initial: String
    var size: CGFloat = 88

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Circle().fill(Theme.primary.opacity(0.15))
                Text(initial).font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(Theme.primary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
        .task(id: fileId) {
            image = nil
            guard let fileId else { return }
            image = await store.image(for: fileId)
        }
    }
}
