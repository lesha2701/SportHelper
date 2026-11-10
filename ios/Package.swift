// swift-tools-version: 6.0
import PackageDescription

// SportArenaKit: everything the iOS app needs that is not a screen - the server client, models and services.
// It builds and is tested with plain `swift test` (no Xcode needed); the SwiftUI app target in Xcode depends on it.
let package = Package(
    name: "SportArenaKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SportArenaKit", targets: ["SportArenaKit"]),
    ],
    targets: [
        .target(name: "SportArenaKit"),
        .testTarget(name: "SportArenaKitTests", dependencies: ["SportArenaKit"]),
    ]
)
