// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "LoopBrowserNativeSupport",
  platforms: [
    .macOS(.v13),
  ],
  products: [
    .library(
      name: "LoopBrowserNativeSupport",
      targets: ["LoopBrowserNativeSupport"]
    ),
  ],
  targets: [
    .target(
      name: "LoopBrowserNativeSupport"
    ),
    .testTarget(
      name: "LoopBrowserNativeSupportTests",
      dependencies: ["LoopBrowserNativeSupport"]
    ),
  ]
)
