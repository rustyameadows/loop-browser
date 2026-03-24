import AppKit
import CoreGraphics
import XCTest
@testable import LoopBrowserNative

@MainActor
final class CanvasInputRouterTests: XCTestCase {
  func testEmptyCanvasMouseDownClearsSelectionAndPans() throws {
    let router = CanvasInputRouter()
    router.transform = CanvasTransform(scale: 1, offset: CGSize(width: 30, height: -15))
    router.hitMap = CanvasHitMap(transform: router.transform, viewports: [])

    var didClearSelection = false
    var panOrigin: CGSize?
    var panTranslation: CGSize?
    var didFinishPan = false

    router.onCanvasMouseDown = {
      didClearSelection = true
    }
    router.onPanChanged = { origin, translation in
      panOrigin = origin
      panTranslation = translation
    }
    router.onPanEnded = {
      didFinishPan = true
    }

    router.mouseDown(at: CGPoint(x: 80, y: 120))
    router.mouseDragged(to: CGPoint(x: 132, y: 168))
    router.mouseUp()

    XCTAssertTrue(didClearSelection)
    let resolvedPanOrigin = try XCTUnwrap(panOrigin)
    let resolvedPanTranslation = try XCTUnwrap(panTranslation)
    XCTAssertEqual(resolvedPanOrigin.width, 30, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanOrigin.height, -15, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanTranslation.width, 52, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanTranslation.height, 48, accuracy: 0.0001)
    XCTAssertTrue(didFinishPan)
  }

  func testScrollOnEmptyCanvasRoutesToPanOnly() throws {
    let router = CanvasInputRouter()
    router.hitMap = CanvasHitMap(transform: CanvasTransform(scale: 1, offset: .zero), viewports: [])

    var scrollDeltaX: CGFloat?
    var scrollDeltaY: CGFloat?
    var zoomCallCount = 0

    router.onScrollPan = { deltaX, deltaY in
      scrollDeltaX = deltaX
      scrollDeltaY = deltaY
    }
    router.onPinchZoom = { _, _ in
      zoomCallCount += 1
    }

    router.scroll(at: CGPoint(x: 40, y: 50), deltaX: 12, deltaY: -28)

    XCTAssertEqual(try XCTUnwrap(scrollDeltaX), 12, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(scrollDeltaY), -28, accuracy: 0.0001)
    XCTAssertEqual(zoomCallCount, 0)
  }

  func testMagnifyOnEmptyCanvasRoutesToZoomOnly() throws {
    let router = CanvasInputRouter()
    router.hitMap = CanvasHitMap(transform: CanvasTransform(scale: 1, offset: .zero), viewports: [])

    var zoomAnchor: CGPoint?
    var zoomFactor: CGFloat?
    var scrollCallCount = 0

    router.onPinchZoom = { point, factor in
      zoomAnchor = point
      zoomFactor = factor
    }
    router.onScrollPan = { _, _ in
      scrollCallCount += 1
    }

    router.magnify(at: CGPoint(x: 320, y: 240), magnification: 0.25)

    let resolvedZoomAnchor = try XCTUnwrap(zoomAnchor)
    XCTAssertEqual(resolvedZoomAnchor.x, 320, accuracy: 0.0001)
    XCTAssertEqual(resolvedZoomAnchor.y, 240, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(zoomFactor), 1.25, accuracy: 0.0001)
    XCTAssertEqual(scrollCallCount, 0)
  }

  func testCanvasInteractionViewPassesViewportContentThrough() {
    let viewportID = UUID()
    let view = CanvasInteractionNSView(frame: CGRect(x: 0, y: 0, width: 1400, height: 1000))
    view.router.transform = CanvasTransform(scale: 1, offset: .zero)
    view.router.hitMap = CanvasHitMap(
      transform: view.router.transform,
      viewports: [
        CanvasHitViewport(
          id: viewportID,
          frame: ViewportFrame(x: 100, y: 100, width: 800, height: 600)
        ),
      ]
    )

    XCTAssertTrue(view.hitTest(CGPoint(x: 20, y: 20)) === view)
    XCTAssertNil(view.hitTest(CGPoint(x: 150, y: 120)))
    XCTAssertNil(view.hitTest(CGPoint(x: 902, y: 380)))
    XCTAssertNil(view.hitTest(CGPoint(x: 260, y: 240)))
    XCTAssertNil(view.hitTest(CGPoint(x: 840, y: 122)))
  }

  func testCanvasInteractionViewUsesFlippedCoordinates() {
    XCTAssertTrue(CanvasInteractionNSView(frame: .zero).isFlipped)
  }
}

@MainActor
final class ProjectServerControllerTests: XCTestCase {
  func testLegacyProjectConfigDecodesWithoutServerSettings() throws {
    let legacyProjectConfigJSON = """
    {
      "version": 1,
      "chrome": {
        "chromeColor": "#FAFBFD",
        "accentColor": "#0A84FF",
        "projectIconPath": null
      },
      "startup": {
        "defaultUrl": "http://127.0.0.1:3000"
      }
    }
    """
    let legacyLocalConfigJSON = """
    {
      "version": 1,
      "agentLogin": {
        "username": "designer@example.com",
        "password": "password123"
      }
    }
    """

    let sharedConfig = try JSONDecoder().decode(ProjectConfigFile.self, from: Data(legacyProjectConfigJSON.utf8))
    let localConfig = try JSONDecoder().decode(LocalAgentLoginFile.self, from: Data(legacyLocalConfigJSON.utf8))

    XCTAssertEqual(sharedConfig.startup?.defaultUrl, "http://127.0.0.1:3000")
    XCTAssertNil(sharedConfig.startup?.server)
    XCTAssertEqual(localConfig.agentLogin?.username, "designer@example.com")
    XCTAssertNil(localConfig.server)
  }

  func testServerConfigRoundTripsWithLocalEnvironmentOverrides() throws {
    let config = ProjectConfigFile(
      version: 1,
      chrome: .init(chromeColor: "#FAFBFD", accentColor: "#0A84FF", projectIconPath: "./icon.icns"),
      startup: .init(
        defaultUrl: "http://127.0.0.1:3000",
        server: .init(
          command: "bin/dev",
          workingDirectory: "apps/site",
          readyUrl: "http://127.0.0.1:3000/health"
        )
      ),
      agentLogin: nil
    )
    let localConfig = LocalAgentLoginFile(
      version: 1,
      agentLogin: .init(username: "designer@example.com", password: "password123"),
      server: .init(environment: ["RAILS_ENV": "development", "PORT": "3000"])
    )

    let decodedConfig = try JSONDecoder().decode(ProjectConfigFile.self, from: JSONEncoder.pretty.encode(config))
    let decodedLocalConfig = try JSONDecoder().decode(LocalAgentLoginFile.self, from: JSONEncoder.pretty.encode(localConfig))

    XCTAssertEqual(decodedConfig.startup?.server?.command, "bin/dev")
    XCTAssertEqual(decodedConfig.startup?.server?.workingDirectory, "apps/site")
    XCTAssertEqual(decodedConfig.startup?.server?.readyUrl, "http://127.0.0.1:3000/health")
    XCTAssertEqual(decodedLocalConfig.server?.environment?["RAILS_ENV"], "development")
    XCTAssertEqual(decodedLocalConfig.server?.environment?["PORT"], "3000")
  }

  func testServerControllerLaunchesReadyHTTPServerAndCapturesOutput() throws {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/python3") else {
      throw XCTSkip("python3 is required for the HTTP server lifecycle test.")
    }

    let temporaryDirectory = try makeTemporaryDirectory()
    try "<!doctype html><title>Server Test</title><p>Hello</p>".write(
      to: temporaryDirectory.appendingPathComponent("index.html"),
      atomically: true,
      encoding: .utf8
    )
    let port = try availableLocalPort()
    let readyURL = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/"))
    let controller = ProjectServerController(readyPollInterval: 0.2, readyTimeout: 5, terminateTimeout: 0.5)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "/usr/bin/python3 -u -m http.server \(port) --bind 127.0.0.1",
        workingDirectory: temporaryDirectory,
        readyURL: readyURL,
        environment: ProcessInfo.processInfo.environment
      )
    )

    let readyState = waitForState(on: controller, timeout: 8) { $0.status == .ready }
    XCTAssertEqual(readyState.status, .ready)
    XCTAssertNotNil(readyState.pid)
    XCTAssertTrue(readyState.recentOutput.contains { $0.contains("GET /") })

    controller.stop()
    let stoppedState = waitForState(on: controller, timeout: 5) { $0.status == .stopped }
    XCTAssertEqual(stoppedState.status, .stopped)
  }

  func testServerControllerReportsSpawnFailure() throws {
    let temporaryDirectory = try makeTemporaryDirectory()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.2)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "exit 7",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    let failedState = waitForState(on: controller, timeout: 3) { $0.status == .failed }
    XCTAssertEqual(failedState.lastExitCode, 7)
    XCTAssertEqual(failedState.status, .failed)
  }

  func testServerControllerGracefullyStopsLongRunningProcess() throws {
    let temporaryDirectory = try makeTemporaryDirectory()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.5)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "trap 'exit 0' TERM; while true; do sleep 1; done",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    XCTAssertEqual(waitForState(on: controller, timeout: 2) { $0.status == .running }.status, .running)
    controller.stop()
    let stoppedState = waitForState(on: controller, timeout: 3) { $0.status == .stopped }
    XCTAssertEqual(stoppedState.status, .stopped)
    XCTAssertNil(stoppedState.lastError)
    XCTAssertNotNil(stoppedState.lastExitCode)
  }

  func testServerControllerForceStopsUnresponsiveProcess() throws {
    let temporaryDirectory = try makeTemporaryDirectory()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.2)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "trap '' TERM; while true; do sleep 1; done",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    XCTAssertEqual(waitForState(on: controller, timeout: 2) { $0.status == .running }.status, .running)
    controller.stop()
    let stoppedState = waitForState(on: controller, timeout: 3) { $0.status == .stopped }
    XCTAssertNotEqual(stoppedState.lastExitCode, 0)
  }

  func testServerControllerKeepsOnlyLatest200LogLines() throws {
    let temporaryDirectory = try makeTemporaryDirectory()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.2)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "for i in {1..230}; do print -r -- \"line-$i\"; done",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    let stoppedState = waitForState(on: controller, timeout: 3) { $0.status == .stopped }
    XCTAssertEqual(stoppedState.recentOutput.count, 200)
    XCTAssertEqual(stoppedState.recentOutput.first, "line-31")
    XCTAssertEqual(stoppedState.recentOutput.last, "line-230")
  }

  func testServerControllerStopCleansUpManagedChildServerProcess() throws {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/python3") else {
      throw XCTSkip("python3 is required for the server cleanup test.")
    }

    let temporaryDirectory = try makeTemporaryDirectory()
    let port = try availableLocalPort()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.3)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "/usr/bin/python3 -u -m http.server \(port) --bind 127.0.0.1 >/dev/null 2>&1 & wait",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    XCTAssertEqual(waitForState(on: controller, timeout: 2) { $0.status == .running }.status, .running)
    XCTAssertTrue(waitForPort(port, isListening: true, timeout: 3))

    controller.stop()

    XCTAssertEqual(waitForState(on: controller, timeout: 3) { $0.status == .stopped }.status, .stopped)
    XCTAssertTrue(waitForPort(port, isListening: false, timeout: 3))
  }

  func testServerControllerInvalidateResetsManagedServerState() throws {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/python3") else {
      throw XCTSkip("python3 is required for the invalidate cleanup test.")
    }

    let temporaryDirectory = try makeTemporaryDirectory()
    let port = try availableLocalPort()
    let controller = ProjectServerController(readyPollInterval: 0.1, readyTimeout: 1, terminateTimeout: 0.3)

    controller.start(
      configuration: .init(
        projectRoot: temporaryDirectory,
        command: "/usr/bin/python3 -u -m http.server \(port) --bind 127.0.0.1 >/dev/null 2>&1 & wait",
        workingDirectory: temporaryDirectory,
        readyURL: nil,
        environment: ProcessInfo.processInfo.environment
      )
    )

    XCTAssertEqual(waitForState(on: controller, timeout: 2) { $0.status == .running }.status, .running)
    XCTAssertTrue(waitForPort(port, isListening: true, timeout: 3))

    controller.invalidate(waitForTermination: true)

    XCTAssertEqual(controller.state.status, .stopped)
    XCTAssertNil(controller.state.pid)
  }

  func testSignalManagedProcessTreeStopsOrphanedServerShell() throws {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/python3") else {
      throw XCTSkip("python3 is required for the orphan cleanup test.")
    }

    let temporaryDirectory = try makeTemporaryDirectory()
    let port = try availableLocalPort()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", "/usr/bin/python3 -u -m http.server \(port) --bind 127.0.0.1 >/dev/null 2>&1"]
    process.currentDirectoryURL = temporaryDirectory
    process.standardOutput = Pipe()
    process.standardError = Pipe()

    try process.run()
    addTeardownBlock {
      if process.isRunning {
        signalManagedProcessTree(rootPID: process.processIdentifier, signal: SIGKILL)
      }
    }

    XCTAssertTrue(waitForPort(port, isListening: true, timeout: 3))

    signalManagedProcessTree(rootPID: process.processIdentifier, signal: SIGTERM)
    let deadline = Date().addingTimeInterval(2)
    while Date() < deadline, isProcessAlive(process.processIdentifier) {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    if isProcessAlive(process.processIdentifier) {
      signalManagedProcessTree(rootPID: process.processIdentifier, signal: SIGKILL)
    }

    XCTAssertTrue(waitForPort(port, isListening: false, timeout: 3))
  }

  private func waitForState(
    on controller: ProjectServerController,
    timeout: TimeInterval,
    condition: (ProjectServerController.State) -> Bool
  ) -> ProjectServerController.State {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if condition(controller.state) {
        return controller.state
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    XCTFail("Timed out waiting for server state condition. Last state: \(controller.state)")
    return controller.state
  }

  private func makeTemporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("loop-browser-server-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock {
      try? FileManager.default.removeItem(at: directory)
    }
    return directory
  }

  private func availableLocalPort() throws -> Int {
    let socketHandle = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard socketHandle >= 0 else {
      throw XCTSkip("Could not allocate a local TCP socket for testing.")
    }
    defer {
      _ = Darwin.close(socketHandle)
    }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(0).bigEndian
    address.sin_addr = in_addr(s_addr: Darwin.inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
        Darwin.bind(socketHandle, reboundPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bindResult == 0 else {
      throw XCTSkip("Could not bind an ephemeral localhost port for testing.")
    }

    var resolvedAddress = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameResult = withUnsafeMutablePointer(to: &resolvedAddress) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
        Darwin.getsockname(socketHandle, reboundPointer, &length)
      }
    }
    guard nameResult == 0 else {
      throw XCTSkip("Could not read the bound localhost port for testing.")
    }

    return Int(UInt16(bigEndian: resolvedAddress.sin_port))
  }

  private func waitForPort(_ port: Int, isListening: Bool, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if portState(port) == isListening {
        return true
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    return portState(port) == isListening
  }

  private func portState(_ port: Int) -> Bool {
    let socketHandle = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard socketHandle >= 0 else { return false }
    defer {
      _ = Darwin.close(socketHandle)
    }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(port)).bigEndian
    address.sin_addr = in_addr(s_addr: Darwin.inet_addr("127.0.0.1"))

    let connectResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
        Darwin.connect(socketHandle, reboundPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }

    return connectResult == 0
  }
}

@MainActor
final class WorkspaceRestoreValidationTests: XCTestCase {
  func testWorkspaceRestoreValidationClampsRecoverableState() throws {
    let oversizedViewportID = UUID()
    let validViewportID = UUID()
    let state = WorkspaceStateFile(
      version: 1,
      canvasScale: 42,
      canvasOffsetX: .infinity,
      canvasOffsetY: -250_000,
      viewports: [
        ViewportSnapshot(
          id: oversizedViewportID,
          label: "Oversized",
          urlString: "http://127.0.0.1:3000/oversized",
          frame: ViewportFrame(x: 150_000, y: -150_000, width: 120, height: 80),
          status: .live,
          lastRefreshedAt: nil
        ),
        ViewportSnapshot(
          id: validViewportID,
          label: "Valid",
          urlString: "http://127.0.0.1:3000/valid",
          frame: ViewportFrame(x: 200, y: 180, width: 1200, height: 800),
          status: .live,
          lastRefreshedAt: nil
        ),
      ],
      inspectorCollapsed: false,
      inspectorWidth: 999
    )

    let result = validateWorkspaceStateForRestore(state)
    XCTAssertEqual(result.disposition, .restored)
    let restored = try XCTUnwrap(result.state)

    XCTAssertEqual(restored.canvasScale, Double(CanvasInteractionMath.maximumCanvasScale), accuracy: 0.0001)
    XCTAssertEqual(restored.canvasOffsetX, 0, accuracy: 0.0001)
    XCTAssertEqual(restored.canvasOffsetY, 0, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(restored.inspectorWidth), 520, accuracy: 0.0001)
    XCTAssertEqual(restored.viewports.count, 2)
    XCTAssertEqual(restored.viewports[0].frame.width, 320, accuracy: 0.0001)
    XCTAssertEqual(restored.viewports[0].frame.height, 240, accuracy: 0.0001)
    XCTAssertLessThan(abs(restored.viewports[0].frame.x), 100_000)
    XCTAssertLessThan(abs(restored.viewports[0].frame.y), 100_000)
    XCTAssertFalse(result.messages.isEmpty)
  }

  func testWorkspaceRestoreValidationQuarantinesWhenMostViewportsAreInvalid() {
    let state = WorkspaceStateFile(
      version: 1,
      canvasScale: 1,
      canvasOffsetX: 0,
      canvasOffsetY: 0,
      viewports: [
        ViewportSnapshot(
          id: UUID(),
          label: "Broken A",
          urlString: "http://127.0.0.1:3000/a",
          frame: ViewportFrame(x: .nan, y: 0, width: 800, height: 600),
          status: .live,
          lastRefreshedAt: nil
        ),
        ViewportSnapshot(
          id: UUID(),
          label: "Broken B",
          urlString: "http://127.0.0.1:3000/b",
          frame: ViewportFrame(x: 0, y: 0, width: .infinity, height: 600),
          status: .live,
          lastRefreshedAt: nil
        ),
        ViewportSnapshot(
          id: UUID(),
          label: "Healthy",
          urlString: "http://127.0.0.1:3000/c",
          frame: ViewportFrame(x: 0, y: 0, width: 800, height: 600),
          status: .live,
          lastRefreshedAt: nil
        ),
      ],
      inspectorCollapsed: false,
      inspectorWidth: 340
    )

    let result = validateWorkspaceStateForRestore(state)
    XCTAssertEqual(result.disposition, .quarantined)
    XCTAssertNil(result.state)
    XCTAssertTrue(result.messages.joined(separator: " ").contains("invalid"))
  }
}
