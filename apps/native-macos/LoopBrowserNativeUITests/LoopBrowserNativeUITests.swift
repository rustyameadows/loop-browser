import CryptoKit
import XCTest

final class LoopBrowserNativeUITests: XCTestCase {
  private struct UITestWorkspaceState: Decodable {
    struct Viewport: Decodable {
      struct Frame: Decodable {
        var x: Double
        var y: Double
        var width: Double
        var height: Double
      }

      var id: UUID
      var frame: Frame
    }

    var canvasScale: Double
    var canvasOffsetX: Double
    var canvasOffsetY: Double
    var viewports: [Viewport]
  }

  private var app: XCUIApplication!
  private var testAppSupportDirectory: URL!

  override func setUpWithError() throws {
    continueAfterFailure = false
    testAppSupportDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("loop-browser-native-uitests-\(UUID().uuidString)", isDirectory: true)
    app = XCUIApplication()
    app.launchEnvironment["LOOP_BROWSER_TEST_PROJECT_ROOT"] = fixtureProjectRoot.path
    app.launchEnvironment["LOOP_BROWSER_TEST_START_URL"] = primaryFixtureURL
    app.launchEnvironment["LOOP_BROWSER_TEST_VIEWPORT_WIDTH"] = "960"
    app.launchEnvironment["LOOP_BROWSER_TEST_VIEWPORT_HEIGHT"] = "640"
    app.launchEnvironment["LOOP_BROWSER_TEST_DISABLE_RESTORE"] = "1"
    app.launchEnvironment["LOOP_BROWSER_TEST_DISABLE_MCP"] = "1"
    app.launchEnvironment["LOOP_BROWSER_APP_SUPPORT_DIR"] = testAppSupportDirectory.path
    app.launch()

    _ = requireOtherElement("viewport-card-0", timeout: 10)
    _ = requireOtherElement("inspector-sidebar")
    _ = waitForWorkspaceState(timeout: 10) { state in
      !state.viewports.isEmpty
    }
  }

  func testEmptyCanvasClickClearsSelection() {
    requireOtherElement("viewport-header-0").click()
    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "selected")

    requireOtherElement("canvas-empty-probe").click()

    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "unselected")
  }

  func testEmptyCanvasScrollPansCanvas() {
    let before = try! XCTUnwrap(workspaceState())

    requireOtherElement("canvas-empty-probe").scroll(byDeltaX: 0, deltaY: -240)

    let after = waitForWorkspaceState { state in
      abs(state.canvasOffsetY - before.canvasOffsetY) > 20
    }
    XCTAssertGreaterThan(abs(after.canvasOffsetY - before.canvasOffsetY), 20)
  }

  func testViewportHeaderDragMovesViewport() {
    let before = viewportCardFrame(index: 0)
    let start = surfaceCoordinate(
      forScreenPoint: CGPoint(
        x: before.minX + before.width * 0.25,
        y: before.minY + 22
      )
    )
    let end = surfaceCoordinate(
      forScreenPoint: CGPoint(
        x: before.minX + before.width * 0.25 + 160,
        y: before.minY + 22 + 110
      )
    )

    start.press(forDuration: 0.05, thenDragTo: end)

    let after = waitForOtherElementFrame(identifier: "viewport-card-0") { frame in
      abs(frame.minX - before.minX) > 120
        && abs(frame.minY - before.minY) > 70
    }
    XCTAssertGreaterThan(abs(after.minX - before.minX), 120)
    XCTAssertGreaterThan(abs(after.minY - before.minY), 70)
  }

  func testResizeHandlesRespectAxisRulesAndShiftMirror() {
    _ = requireOtherElement("viewport-resize-right-0")
    let beforeEdgeResize = viewportCardFrame(index: 0)
    let rightStart = surfaceCoordinate(
      forScreenPoint: CGPoint(
        x: beforeEdgeResize.maxX + 4,
        y: beforeEdgeResize.midY
      )
    )
    let rightEnd = surfaceCoordinate(
      forScreenPoint: CGPoint(
        x: beforeEdgeResize.maxX + 124,
        y: beforeEdgeResize.midY
      )
    )
    rightStart.press(forDuration: 0.05, thenDragTo: rightEnd)

    let afterEdgeResize = waitForOtherElementFrame(identifier: "viewport-card-0") { frame in
      frame.width - beforeEdgeResize.width > 90
    }
    XCTAssertGreaterThan(afterEdgeResize.width - beforeEdgeResize.width, 90)
    XCTAssertLessThan(abs(afterEdgeResize.height - beforeEdgeResize.height), 8)

    _ = requireOtherElement("viewport-resize-bottom-right-0")
    let beforeShiftResize = afterEdgeResize

    XCUIElement.perform(withKeyModifiers: .shift) {
      let start = surfaceCoordinate(
        forScreenPoint: CGPoint(
          x: beforeShiftResize.maxX + 4,
          y: beforeShiftResize.maxY + 4
        )
      )
      let end = surfaceCoordinate(
        forScreenPoint: CGPoint(
          x: beforeShiftResize.maxX + 64,
          y: beforeShiftResize.maxY + 54
        )
      )
      start.press(forDuration: 0.05, thenDragTo: end)
    }

    let afterShiftResize = waitForOtherElementFrame(identifier: "viewport-card-0") { frame in
      frame.width - beforeShiftResize.width > 90
        && frame.height - beforeShiftResize.height > 70
        && abs(frame.midX - beforeShiftResize.midX) < 16
        && abs(frame.midY - beforeShiftResize.midY) < 16
    }
    XCTAssertGreaterThan(afterShiftResize.width - beforeShiftResize.width, 90)
    XCTAssertGreaterThan(afterShiftResize.height - beforeShiftResize.height, 70)
    XCTAssertLessThan(abs(afterShiftResize.midX - beforeShiftResize.midX), 16)
    XCTAssertLessThan(abs(afterShiftResize.midY - beforeShiftResize.midY), 16)
  }

  func testViewportWebContentRemainsInteractive() {
    requireButton("inspector-toggle").click()
    requireOtherElement("canvas-empty-probe").click()

    let primaryWebView = requireWebView(labeled: "Primary View")
    let incrementButton = primaryWebView.buttons["Increment Counter"].firstMatch
    XCTAssertTrue(incrementButton.waitForExistence(timeout: 10))
    incrementButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    XCTAssertTrue(primaryWebView.staticTexts["Counter: 1"].waitForExistence(timeout: 5))

    let textField = primaryWebView.textFields["Fixture Input"].firstMatch
    XCTAssertTrue(textField.waitForExistence(timeout: 5))
    textField.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    app.typeText("Loop Native")

    let typedValue = textField.value as? String ?? ""
    XCTAssertTrue(typedValue.contains("Loop Native"))
  }

  func testInspectorToggleCollapsesAndReopens() {
    let toggle = requireButton("inspector-toggle")
    let inspector = requireOtherElement("inspector-sidebar")

    toggle.click()
    XCTAssertTrue(waitForNonExistence(of: inspector))

    toggle.click()
    XCTAssertTrue(inspector.waitForExistence(timeout: 5))
  }

  func testToolbarZoomCommandsChangeCanvasPresentation() {
    let baseline = viewportCardFrame(index: 0)

    requireButton("canvas-zoom-in").click()
    let zoomedIn = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
      frame.width > baseline.width * 1.05
    }
    XCTAssertGreaterThan(zoomedIn.width, baseline.width * 1.05)

    app.typeKey("0", modifierFlags: .command)
    let reset = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
      abs(frame.width - baseline.width) < 8
        && abs(frame.height - baseline.height) < 8
        && abs(frame.minX - baseline.minX) < 8
        && abs(frame.minY - baseline.minY) < 8
    }
    XCTAssertLessThan(abs(reset.width - baseline.width), 8)
    XCTAssertLessThan(abs(reset.height - baseline.height), 8)
    XCTAssertLessThan(abs(reset.minX - baseline.minX), 8)
    XCTAssertLessThan(abs(reset.minY - baseline.minY), 8)

    requireButton("canvas-zoom-out").click()
    let zoomedOut = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
      frame.width < baseline.width * 0.95
    }
    XCTAssertLessThan(zoomedOut.width, baseline.width * 0.95)
  }

  func testRepeatedZoomCommandsRemainResponsive() {
    let baseline = viewportCardFrame(index: 0)
    let baselineState = try! XCTUnwrap(workspaceState())
    let zoomOutButton = requireButton("canvas-zoom-out")
    let zoomInButton = requireButton("canvas-zoom-in")
    let actualSizeButton = requireButton("canvas-zoom-reset")
    let inspectorToggle = requireButton("inspector-toggle")
    let inspector = requireOtherElement("inspector-sidebar")

    for cycle in 1...3 {
      zoomOutButton.click()
      let zoomedOut = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
        frame.width < baseline.width * 0.95
      }
      let zoomedOutState = waitForWorkspaceState(timeout: 10) { state in
        state.canvasScale < baselineState.canvasScale * 0.95
      }
      XCTAssertLessThan(
        zoomedOut.width,
        baseline.width * 0.95,
        "Cycle \(cycle) zoom out did not shrink the viewport."
      )
      XCTAssertLessThan(
        zoomedOutState.canvasScale,
        baselineState.canvasScale * 0.95,
        "Cycle \(cycle) persisted zoom-out scale did not decrease."
      )

      zoomInButton.click()
      let zoomedIn = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
        frame.width > zoomedOut.width * 1.05
      }
      let zoomedInState = waitForWorkspaceState(timeout: 10) { state in
        state.canvasScale > zoomedOutState.canvasScale * 1.05
      }
      XCTAssertGreaterThan(
        zoomedIn.width,
        zoomedOut.width * 1.05,
        "Cycle \(cycle) zoom in did not expand the viewport again."
      )
      XCTAssertGreaterThan(
        zoomedInState.canvasScale,
        zoomedOutState.canvasScale * 1.05,
        "Cycle \(cycle) persisted zoom-in scale did not increase."
      )

      actualSizeButton.click()
      let reset = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
        abs(frame.width - baseline.width) < 8
          && abs(frame.height - baseline.height) < 8
          && abs(frame.minX - baseline.minX) < 8
          && abs(frame.minY - baseline.minY) < 8
      }
      let resetState = waitForWorkspaceState(timeout: 10) { state in
        abs(state.canvasScale - baselineState.canvasScale) < 0.02
      }
      XCTAssertLessThan(abs(reset.width - baseline.width), 8, "Cycle \(cycle) actual size width drifted.")
      XCTAssertLessThan(abs(reset.height - baseline.height), 8, "Cycle \(cycle) actual size height drifted.")
      XCTAssertLessThan(abs(reset.minX - baseline.minX), 8, "Cycle \(cycle) actual size x drifted.")
      XCTAssertLessThan(abs(reset.minY - baseline.minY), 8, "Cycle \(cycle) actual size y drifted.")
      XCTAssertLessThan(
        abs(resetState.canvasScale - baselineState.canvasScale),
        0.02,
        "Cycle \(cycle) persisted actual-size scale did not return to baseline."
      )
    }

    zoomOutButton.click()
    let finalZoomOut = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
      frame.width < baseline.width * 0.95
    }
    XCTAssertLessThan(finalZoomOut.width, baseline.width * 0.95)

    zoomInButton.click()
    let finalZoomIn = waitForOtherElementFrame(identifier: "viewport-card-0", timeout: 10) { frame in
      frame.width > finalZoomOut.width * 1.05
    }
    XCTAssertGreaterThan(finalZoomIn.width, finalZoomOut.width * 1.05)

    inspectorToggle.click()
    XCTAssertTrue(waitForNonExistence(of: inspector))
    inspectorToggle.click()
    XCTAssertTrue(inspector.waitForExistence(timeout: 5))
  }

  private var nativeMacOSRoot: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private var fixtureProjectRoot: URL {
    nativeMacOSRoot.appendingPathComponent("TestFixtures/interactive-project", isDirectory: true)
  }

  private var primaryFixtureURL: String {
    fixtureURL(title: "Primary View", subtitle: "Primary interactive fixture viewport.")
  }
  private func fixtureURL(title: String, subtitle: String) -> String {
    var components = URLComponents(
      url: fixtureProjectRoot.appendingPathComponent("interactive-fixture.html"),
      resolvingAgainstBaseURL: false
    )!
    components.queryItems = [
      URLQueryItem(name: "title", value: title),
      URLQueryItem(name: "subtitle", value: subtitle),
    ]
    return components.url!.absoluteString
  }

  private func waitForNonExistence(of element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
    let predicate = NSPredicate(format: "exists == false")
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
    return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
  }

  private func workspaceState() -> UITestWorkspaceState? {
    guard
      let data = try? Data(contentsOf: workspaceStateFileURL()),
      let state = try? JSONDecoder().decode(UITestWorkspaceState.self, from: data)
    else {
      return nil
    }
    return state
  }

  private func waitForWorkspaceState(
    timeout: TimeInterval = 5,
    condition: (UITestWorkspaceState) -> Bool
  ) -> UITestWorkspaceState {
    let deadline = Date().addingTimeInterval(timeout)
    var lastState: UITestWorkspaceState?
    while Date() < deadline {
      if let state = workspaceState() {
        lastState = state
        if condition(state) {
          return state
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    if let lastState {
      XCTFail(
        "Timed out waiting for workspace state condition. Last state: scale=\(lastState.canvasScale), offset=(\(lastState.canvasOffsetX), \(lastState.canvasOffsetY)), viewportCount=\(lastState.viewports.count)"
      )
    } else {
      XCTFail("Timed out waiting for workspace state condition")
    }
    return try! XCTUnwrap(workspaceState())
  }

  private func waitForOtherElementFrame(
    identifier: String,
    timeout: TimeInterval = 5,
    condition: (CGRect) -> Bool
  ) -> CGRect {
    let deadline = Date().addingTimeInterval(timeout)
    var lastFrame = CGRect.null
    while Date() < deadline {
      let frame = app.otherElements.matching(identifier: identifier).firstMatch.frame
      if !frame.isEmpty {
        lastFrame = frame
        if condition(frame) {
          return frame
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    XCTFail("Timed out waiting for \(identifier) frame condition. Last frame: \(NSStringFromRect(lastFrame))")
    return app.otherElements.matching(identifier: identifier).firstMatch.frame
  }

  private func viewportCardFrame(index: Int) -> CGRect {
    requireOtherElement("viewport-card-\(index)").frame
  }

  private func surfaceCoordinate(forScreenPoint screenPoint: CGPoint) -> XCUICoordinate {
    let surface = requireOtherElement("canvas-interaction-surface")
    let frame = surface.frame
    return surface.coordinate(withNormalizedOffset: .zero).withOffset(
      CGVector(
        dx: screenPoint.x - frame.minX,
        dy: frame.height - (screenPoint.y - frame.minY)
      )
    )
  }

  @discardableResult
  private func requireOtherElement(_ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
    let query = app.otherElements.matching(identifier: identifier)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected other element \(identifier) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one other element with identifier \(identifier)")
    return element
  }

  @discardableResult
  private func requireButton(_ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
    let query = app.buttons.matching(identifier: identifier)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected button \(identifier) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one button with identifier \(identifier)")
    return element
  }

  @discardableResult
  private func requireWebView(labeled label: String, timeout: TimeInterval = 5) -> XCUIElement {
    let predicate = NSPredicate(format: "label == %@", label)
    let query = app.webViews.matching(predicate)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected web view labeled \(label) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one web view labeled \(label)")
    return element
  }

  private func workspaceStateFileURL() -> URL {
    testAppSupportDirectory
      .appendingPathComponent("projects", isDirectory: true)
      .appendingPathComponent(projectSessionSlug, isDirectory: true)
      .appendingPathComponent("workspace-state.json")
  }

  private var projectSessionSlug: String {
    let base = fixtureProjectRoot.lastPathComponent.lowercased()
      .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let hash = SHA256.hash(data: Data(fixtureProjectRoot.path.utf8))
      .compactMap { String(format: "%02x", $0) }
      .joined()
      .prefix(8)
    let prefix = base.isEmpty ? "project" : String(base.prefix(36))
    return "\(prefix)-\(hash)"
  }
}
