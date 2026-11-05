import SwiftUI

/// A tab whose real screen is the next step. Honest about it: nothing here pretends to work.
struct ComingSoonView: View {
    let title: String
    let symbol: String
    let text: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(title, systemImage: symbol, description: Text(text))
                .sagScreen()
                .navigationTitle(title)
        }
    }
}
