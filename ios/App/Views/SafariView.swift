import SafariServices
import SwiftUI

/// A web page inside the app (Safari's own controller: the address bar shows where the person really is, and the app can never read
/// what is typed there). Used for the payment page: card details are entered on the bank's page, never in the app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// An address to show in a sheet (`sheet(item:)` needs an identifiable value).
struct PageToOpen: Identifiable {
    let url: URL
    let bookingId: UUID
    var id: UUID { bookingId }
}
