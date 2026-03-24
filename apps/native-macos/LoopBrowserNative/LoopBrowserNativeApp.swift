import AppKit
import CryptoKit
import Darwin
import SwiftUI
import WebKit

enum ViewportStatus: String, Codable, CaseIterable {
  case restoring
  case loading
  case live
  case refreshing
  case error
  case disconnected
}

struct ViewportSnapshot: Codable, Identifiable {
  var id: UUID
  var label: String
  var urlString: String
  var frame: ViewportFrame
  var status: ViewportStatus
  var lastRefreshedAt: Date?
}

struct WorkspaceStateFile: Codable {
  var version: Int = 1
  var canvasScale: Double
  var canvasOffsetX: Double
  var canvasOffsetY: Double
  var viewports: [ViewportSnapshot]
  var inspectorCollapsed: Bool?
  var inspectorWidth: Double?
}

struct ProjectConfigFile: Codable {
  struct Chrome: Codable {
    var chromeColor: String
    var accentColor: String
    var projectIconPath: String?
  }

  struct Startup: Codable {
    struct Server: Codable {
      var command: String
      var workingDirectory: String?
      var readyUrl: String?
    }

    var defaultUrl: String?
    var server: Server?
  }

  struct AgentLoginEnv: Codable {
    var usernameEnv: String?
    var passwordEnv: String?
  }

  var version: Int
  var chrome: Chrome
  var startup: Startup?
  var agentLogin: AgentLoginEnv?

  static var `default`: ProjectConfigFile {
    ProjectConfigFile(
      version: 1,
      chrome: Chrome(
        chromeColor: "#FAFBFD",
        accentColor: "#0A84FF",
        projectIconPath: nil
      ),
      startup: nil,
      agentLogin: nil
    )
  }
}

struct LocalAgentLoginFile: Codable {
  struct Credentials: Codable {
    var username: String
    var password: String
  }

  struct Server: Codable {
    var environment: [String: String]?
  }

  var version: Int
  var agentLogin: Credentials?
  var server: Server?

  static var `default`: LocalAgentLoginFile {
    LocalAgentLoginFile(version: 1, agentLogin: nil, server: nil)
  }
}

struct SessionSummary: Codable {
  var sessionId: String
  var projectRoot: String
  var projectName: String
  var defaultUrl: String
  var viewportCount: Int
}

struct ManagedProjectServerRecord: Codable {
  var version: Int = 1
  var rootPID: Int32
  var processGroupID: Int32?
  var projectRootPath: String
  var command: String
  var workingDirectoryPath: String
  var readyURL: String?
  var startedAt: Date
}

struct ActionLogEntry: Identifiable, Hashable {
  let id = UUID()
  let timestamp = Date()
  let title: String
  let detail: String
  let success: Bool
}

struct WorkspaceNotice: Identifiable, Equatable {
  enum Kind: Equatable {
    case recovery
    case configuration
  }

  let id = UUID()
  var kind: Kind
  var title: String
  var detail: String
  var allowsRetryRestore: Bool = false
  var allowsResetSavedWorkspace: Bool = false
}

struct WorkspaceRestoreValidationResult {
  enum Disposition: Equatable {
    case restored
    case quarantined
  }

  var disposition: Disposition
  var state: WorkspaceStateFile?
  var messages: [String]

  static func restored(_ state: WorkspaceStateFile, messages: [String] = []) -> WorkspaceRestoreValidationResult {
    WorkspaceRestoreValidationResult(disposition: .restored, state: state, messages: messages)
  }

  static func quarantined(_ reason: String) -> WorkspaceRestoreValidationResult {
    WorkspaceRestoreValidationResult(disposition: .quarantined, state: nil, messages: [reason])
  }
}

struct MCPConnectionInfo {
  var url: String
  var token: String
  var registrationFile: String
}

@MainActor
protocol AssistantService {
  var modeName: String { get }
  var statusSummary: String { get }
}

final class EmbeddedCodexAssistantAdapter: AssistantService {
  var modeName: String { "Embedded Codex" }
  var statusSummary: String {
    "Planned for Phase 2. External Codex via MCP is the live Phase 1 path."
  }
}

extension Color {
  init?(hex: String) {
    let trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count == 7, trimmed.hasPrefix("#") else {
      return nil
    }

    let scanner = Scanner(string: String(trimmed.dropFirst()))
    var value: UInt64 = 0
    guard scanner.scanHexInt64(&value) else {
      return nil
    }

    let red = Double((value >> 16) & 0xFF) / 255.0
    let green = Double((value >> 8) & 0xFF) / 255.0
    let blue = Double(value & 0xFF) / 255.0
    self = Color(red: red, green: green, blue: blue)
  }
}

extension String {
  var isHexColor: Bool {
    guard count == 7, hasPrefix("#") else {
      return false
    }

    return dropFirst().allSatisfy { character in
      character.isHexDigit
    }
  }
}

extension URL {
  var loopOrigin: String? {
    guard let scheme, let host else {
      return nil
    }

    if let port {
      return "\(scheme)://\(host):\(port)"
    }

    return "\(scheme)://\(host)"
  }
}

func normalizeAddress(_ input: String) throws -> String {
  let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw NSError(domain: "LoopBrowserNative", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Enter a URL to navigate.",
    ])
  }

  if trimmed == "about:blank" {
    return trimmed
  }

  if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("file://") {
    return URL(string: trimmed)?.absoluteString ?? trimmed
  }

  if trimmed.hasPrefix("/") {
    return URL(fileURLWithPath: trimmed).absoluteString
  }

  let authority = trimmed.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? trimmed
  let host = authority.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? authority
  let isLocalHost = host == "localhost"
    || host == "0.0.0.0"
    || host.range(of: #"^127(?:\.\d{1,3}){3}$"#, options: .regularExpression) != nil

  if isLocalHost {
    return URL(string: "http://\(trimmed)")?.absoluteString ?? trimmed
  }

  return URL(string: "https://\(trimmed)")?.absoluteString ?? trimmed
}

func resolveHTTPReadyURL(_ input: String) throws -> URL {
  let normalized = try normalizeAddress(input)
  guard let url = URL(string: normalized),
        let scheme = url.scheme?.lowercased(),
        scheme == "http" || scheme == "https"
  else {
    throw NSError(domain: "LoopBrowserNative", code: 8, userInfo: [
      NSLocalizedDescriptionKey: "Ready URL must be an http:// or https:// address.",
    ])
  }
  return url
}

func deriveProjectSessionSlug(projectRoot: URL) -> String {
  let base = projectRoot.lastPathComponent.lowercased()
    .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  let hash = SHA256.hash(data: Data(projectRoot.path.utf8))
    .compactMap { String(format: "%02x", $0) }
    .joined()
    .prefix(8)
  let prefix = base.isEmpty ? "project" : String(base.prefix(36))
  return "\(prefix)-\(hash)"
}

func applicationSupportDirectory() -> URL {
  if let overridePath = ProcessInfo.processInfo.environment["LOOP_BROWSER_APP_SUPPORT_DIR"],
     !overridePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return URL(fileURLWithPath: overridePath, isDirectory: true)
  }

  let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
  return base.appendingPathComponent("Loop Browser Native", isDirectory: true)
}

func projectWorkspaceDirectory(projectRoot: URL) -> URL {
  applicationSupportDirectory()
    .appendingPathComponent("projects", isDirectory: true)
    .appendingPathComponent(deriveProjectSessionSlug(projectRoot: projectRoot), isDirectory: true)
}

func workspaceStateURL(projectRoot: URL) -> URL {
  projectWorkspaceDirectory(projectRoot: projectRoot).appendingPathComponent("workspace-state.json")
}

func managedProjectServerRecordURL(projectRoot: URL) -> URL {
  projectWorkspaceDirectory(projectRoot: projectRoot).appendingPathComponent("managed-project-server.json")
}

func quarantinedWorkspaceStateURL(projectRoot: URL, date: Date = Date()) -> URL {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(secondsFromGMT: 0)
  formatter.dateFormat = "yyyyMMdd-HHmmss"
  let stamp = formatter.string(from: date)
  return projectWorkspaceDirectory(projectRoot: projectRoot)
    .appendingPathComponent("workspace-state-\(stamp).invalid-workspace-state.json")
}

func isProcessAlive(_ pid: Int32) -> Bool {
  guard pid > 0 else { return false }
  if Darwin.kill(pid, 0) == 0 {
    return true
  }
  return errno == EPERM
}

func establishManagedProcessGroup(rootPID: Int32) -> Int32? {
  guard rootPID > 0 else { return nil }
  if Darwin.setpgid(rootPID, rootPID) == 0 {
    return rootPID
  }

  errno = 0
  let processGroupID = Darwin.getpgid(rootPID)
  guard processGroupID > 0, processGroupID == rootPID else {
    return nil
  }
  return processGroupID
}

func isProcessGroupAlive(_ processGroupID: Int32) -> Bool {
  guard processGroupID > 0 else { return false }
  if Darwin.kill(-processGroupID, 0) == 0 {
    return true
  }
  return errno == EPERM
}

func childProcessIDs(of parentPID: Int32) -> [Int32] {
  let process = Process()
  let outputPipe = Pipe()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
  process.arguments = ["-P", String(parentPID)]
  process.standardOutput = outputPipe
  process.standardError = Pipe()

  do {
    try process.run()
  } catch {
    return []
  }

  process.waitUntilExit()
  guard process.terminationStatus == 0 else { return [] }

  let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
  let output = String(decoding: data, as: UTF8.self)
  return output
    .split(whereSeparator: \.isNewline)
    .compactMap { Int32($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
}

func descendantProcessIDs(of rootPID: Int32) -> [Int32] {
  var visited: Set<Int32> = []

  func collect(from pid: Int32) -> [Int32] {
    guard visited.insert(pid).inserted else { return [] }
    let children = childProcessIDs(of: pid)
    var descendants: [Int32] = []
    for childPID in children {
      descendants.append(contentsOf: collect(from: childPID))
      descendants.append(childPID)
    }
    return descendants
  }

  return collect(from: rootPID)
}

func signalManagedProcessTree(rootPID: Int32, signal: Int32) {
  for descendantPID in descendantProcessIDs(of: rootPID) {
    if isProcessAlive(descendantPID) {
      Darwin.kill(descendantPID, signal)
    }
  }
  if isProcessAlive(rootPID) {
    Darwin.kill(rootPID, signal)
  }
}

func signalManagedServer(processGroupID: Int32?, rootPID: Int32, signal: Int32) {
  if let processGroupID, isProcessGroupAlive(processGroupID) {
    Darwin.kill(-processGroupID, signal)
  }
  signalManagedProcessTree(rootPID: rootPID, signal: signal)
}

func waitForManagedServerExit(processGroupID: Int32?, rootPID: Int32, timeout: TimeInterval) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  repeat {
    let rootAlive = isProcessAlive(rootPID)
    let groupAlive = processGroupID.map(isProcessGroupAlive) ?? false
    if !rootAlive && !groupAlive {
      return true
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
  } while Date() < deadline

  return !isProcessAlive(rootPID) && !(processGroupID.map(isProcessGroupAlive) ?? false)
}

func makeProjectServerURLSession() -> URLSession {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  configuration.timeoutIntervalForRequest = 2
  configuration.timeoutIntervalForResource = 2
  configuration.waitsForConnectivity = false
  configuration.connectionProxyDictionary = [:]
  return URLSession(configuration: configuration)
}

func validateWorkspaceStateForRestore(
  _ state: WorkspaceStateFile,
  canvasCenter: CGPoint = CGPoint(x: 1600, y: 1200)
) -> WorkspaceRestoreValidationResult {
  let minimumScale = Double(CanvasInteractionMath.minimumCanvasScale)
  let maximumScale = Double(CanvasInteractionMath.maximumCanvasScale)
  let minimumInspectorWidth = 280.0
  let maximumInspectorWidth = 520.0
  let maximumAbsoluteOrigin = 100_000.0
  let minimumViewportWidth = 320.0
  let maximumViewportWidth = 4_000.0
  let minimumViewportHeight = 240.0
  let maximumViewportHeight = 3_000.0

  guard state.canvasScale.isFinite else {
    return .quarantined("Saved workspace canvas zoom was invalid.")
  }

  var messages: [String] = []
  let clampedScale = min(max(state.canvasScale, minimumScale), maximumScale)
  if abs(clampedScale - state.canvasScale) > 0.0001 {
    messages.append("Clamped saved canvas zoom.")
  }

  let sanitizedOffsetX: Double
  let sanitizedOffsetY: Double
  if state.canvasOffsetX.isFinite, abs(state.canvasOffsetX) <= maximumAbsoluteOrigin {
    sanitizedOffsetX = state.canvasOffsetX
  } else {
    sanitizedOffsetX = 0
    messages.append("Reset saved canvas horizontal offset.")
  }
  if state.canvasOffsetY.isFinite, abs(state.canvasOffsetY) <= maximumAbsoluteOrigin {
    sanitizedOffsetY = state.canvasOffsetY
  } else {
    sanitizedOffsetY = 0
    messages.append("Reset saved canvas vertical offset.")
  }

  let clampedInspectorWidth = min(max(state.inspectorWidth ?? 340, minimumInspectorWidth), maximumInspectorWidth)
  if let inspectorWidth = state.inspectorWidth, abs(inspectorWidth - clampedInspectorWidth) > 0.0001 {
    messages.append("Clamped saved inspector width.")
  }

  var restoredViewports: [ViewportSnapshot] = []
  var droppedViewportCount = 0

  for snapshot in state.viewports {
    let frame = snapshot.frame
    guard frame.x.isFinite, frame.y.isFinite, frame.width.isFinite, frame.height.isFinite else {
      droppedViewportCount += 1
      continue
    }

    let clampedWidth = min(max(frame.width, minimumViewportWidth), maximumViewportWidth)
    let clampedHeight = min(max(frame.height, minimumViewportHeight), maximumViewportHeight)

    var restoredFrame = ViewportFrame(
      x: frame.x,
      y: frame.y,
      width: clampedWidth,
      height: clampedHeight
    )

    if abs(frame.width - clampedWidth) > 0.0001 || abs(frame.height - clampedHeight) > 0.0001 {
      messages.append("Clamped saved viewport size for \(snapshot.label).")
    }

    if abs(frame.x) > maximumAbsoluteOrigin || abs(frame.y) > maximumAbsoluteOrigin {
      restoredFrame = CanvasInteractionMath.spawnedViewportFrame(
        center: canvasCenter,
        width: clampedWidth,
        height: clampedHeight,
        staggerIndex: restoredViewports.count
      )
      messages.append("Recentered saved viewport \(snapshot.label).")
    }

    let restoredSnapshot = ViewportSnapshot(
      id: snapshot.id,
      label: snapshot.label,
      urlString: snapshot.urlString,
      frame: restoredFrame,
      status: snapshot.status,
      lastRefreshedAt: snapshot.lastRefreshedAt
    )
    restoredViewports.append(restoredSnapshot)
  }

  if !state.viewports.isEmpty, droppedViewportCount * 2 > state.viewports.count {
    return .quarantined("Saved workspace had too many invalid viewports to restore safely.")
  }

  if droppedViewportCount > 0 {
    messages.append("Dropped \(droppedViewportCount) invalid saved viewport(s).")
  }

  return .restored(
    WorkspaceStateFile(
      version: state.version,
      canvasScale: clampedScale,
      canvasOffsetX: sanitizedOffsetX,
      canvasOffsetY: sanitizedOffsetY,
      viewports: restoredViewports,
      inspectorCollapsed: state.inspectorCollapsed ?? false,
      inspectorWidth: clampedInspectorWidth
    ),
    messages: messages
  )
}

func projectConfigURL(projectRoot: URL) -> URL {
  projectRoot.appendingPathComponent(".loop-browser.json")
}

func localLoginURL(projectRoot: URL) -> URL {
  projectRoot.appendingPathComponent(".loop-browser.local.json")
}

func projectRelativePath(projectRoot: URL, fileURL: URL) throws -> String {
  let resolvedRoot = projectRoot.standardizedFileURL.path
  let resolvedFile = fileURL.standardizedFileURL.path
  guard resolvedFile.hasPrefix(resolvedRoot + "/") else {
    throw NSError(domain: "LoopBrowserNative", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "Selected icon must be inside the current project folder.",
    ])
  }

  let relative = String(resolvedFile.dropFirst(resolvedRoot.count + 1))
  return "./" + relative
}

func resolveProjectDirectoryURL(projectRoot: URL, relativePath: String?) throws -> URL {
  guard let relativePath else {
    return projectRoot
  }

  let trimmed = relativePath.replacingOccurrences(of: "\\", with: "/")
    .trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return projectRoot
  }
  guard !trimmed.hasPrefix("/") else {
    throw NSError(domain: "LoopBrowserNative", code: 5, userInfo: [
      NSLocalizedDescriptionKey: "Server working directory must be relative to the current project root.",
    ])
  }

  let candidate = projectRoot.appendingPathComponent(trimmed).standardizedFileURL
  let rootPath = projectRoot.standardizedFileURL.path + "/"
  guard candidate.path.hasPrefix(rootPath) else {
    throw NSError(domain: "LoopBrowserNative", code: 6, userInfo: [
      NSLocalizedDescriptionKey: "Server working directory must stay inside the current project root.",
    ])
  }

  var isDirectory: ObjCBool = false
  guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), isDirectory.boolValue else {
    throw NSError(domain: "LoopBrowserNative", code: 7, userInfo: [
      NSLocalizedDescriptionKey: "Server working directory must point to an existing folder inside the current project root.",
    ])
  }

  return candidate
}

func resolvedProjectIconURL(projectRoot: URL, projectIconPath: String?) -> URL? {
  guard let projectIconPath, !projectIconPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    return nil
  }

  let trimmed = projectIconPath.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.hasPrefix("/") {
    return URL(fileURLWithPath: trimmed)
  }

  return projectRoot.appendingPathComponent(trimmed.replacingOccurrences(of: "./", with: ""))
}

enum CanvasUI {
  static let headerHeight: CGFloat = 46
  static let edgeHandleThickness: CGFloat = 20
  static let edgeHandleLength: CGFloat = 72
  static let cornerHandleSize: CGFloat = 24
  static let handleOutset: CGFloat = 2
  static let headerTrailingPassthroughWidth: CGFloat = 280
}

struct AccessibilityMarkerView: NSViewRepresentable {
  var identifier: String
  var label: String? = nil
  var value: String? = nil

  func makeNSView(context: Context) -> AccessibilityMarkerNSView {
    let view = AccessibilityMarkerNSView()
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.clear.cgColor
    return view
  }

  func updateNSView(_ nsView: AccessibilityMarkerNSView, context: Context) {
    nsView.setAccessibilityElement(true)
    nsView.setAccessibilityIdentifier(identifier)
    nsView.setAccessibilityLabel(label ?? identifier)
    nsView.setAccessibilityValue(value)
  }
}

final class AccessibilityMarkerNSView: NSView {
  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }
}

struct DragCaptureSurface: NSViewRepresentable {
  var identifier: String
  var label: String
  var onPress: () -> Void
  var onDragChanged: (CGSize) -> Void
  var onDragEnded: () -> Void

  func makeNSView(context: Context) -> DragCaptureNSView {
    let view = DragCaptureNSView()
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.clear.cgColor
    return view
  }

  func updateNSView(_ nsView: DragCaptureNSView, context: Context) {
    nsView.onPress = onPress
    nsView.onDragChanged = onDragChanged
    nsView.onDragEnded = onDragEnded
    nsView.setAccessibilityElement(true)
    nsView.setAccessibilityIdentifier(identifier)
    nsView.setAccessibilityLabel(label)
  }
}

final class DragCaptureNSView: NSView {
  var onPress: (() -> Void)?
  var onDragChanged: ((CGSize) -> Void)?
  var onDragEnded: (() -> Void)?

  private var dragOriginInWindow: CGPoint?
  private var didDrag = false

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    dragOriginInWindow = event.locationInWindow
    didDrag = false
    onPress?()
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragOriginInWindow else { return }
    didDrag = true
    let currentPoint = event.locationInWindow
    onDragChanged?(
      CGSize(
        width: currentPoint.x - dragOriginInWindow.x,
        height: dragOriginInWindow.y - currentPoint.y
      )
    )
  }

  override func mouseUp(with event: NSEvent) {
    if didDrag {
      onDragEnded?()
    }
    dragOriginInWindow = nil
    didDrag = false
  }
}

@MainActor
func reclaimWindowInputFocus(preferredResponder: NSResponder? = nil) {
  let candidateWindow =
    (preferredResponder as? NSView)?.window
    ?? NSApp.keyWindow
    ?? NSApp.mainWindow

  guard let candidateWindow else { return }

  if let preferredResponder {
    _ = candidateWindow.makeFirstResponder(preferredResponder)
  } else {
    _ = candidateWindow.makeFirstResponder(nil)
  }
}

@MainActor
func activateNativeTestWindowIfNeeded() {
  guard NativeLaunchOptions.current.projectRoot != nil else { return }

  func activate() {
    NSApp.activate(ignoringOtherApps: true)
    NSApp.windows.forEach { window in
      window.makeKeyAndOrderFront(nil)
    }
  }

  activate()
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
    activate()
  }
}

func nativeUITestDebugLog(_ message: @autoclosure () -> String) {
  guard NativeLaunchOptions.current.projectRoot != nil else { return }
  print("[NativeUITestDebug] \(message())")
}

struct NativeLaunchOptions {
  var projectRoot: URL?
  var startupURLs: [String]
  var startupViewportWidth: Double?
  var startupViewportHeight: Double?
  var disableWorkspaceRestore: Bool
  var disableMCP: Bool

  static var current: NativeLaunchOptions {
    let environment = ProcessInfo.processInfo.environment
    let projectRoot = environment["LOOP_BROWSER_TEST_PROJECT_ROOT"]
      .flatMap { value -> URL? in
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed, isDirectory: true)
      }

    let startupURLs = [
      environment["LOOP_BROWSER_TEST_START_URL"],
      environment["LOOP_BROWSER_TEST_SECONDARY_URL"],
    ]
    .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }

    let startupViewportWidth = environment["LOOP_BROWSER_TEST_VIEWPORT_WIDTH"]
      .flatMap { Double($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
    let startupViewportHeight = environment["LOOP_BROWSER_TEST_VIEWPORT_HEIGHT"]
      .flatMap { Double($0.trimmingCharacters(in: .whitespacesAndNewlines)) }

    let disableWorkspaceRestore = environment["LOOP_BROWSER_TEST_DISABLE_RESTORE"] == "1"
    let disableMCP = environment["LOOP_BROWSER_TEST_DISABLE_MCP"] == "1"

    return NativeLaunchOptions(
      projectRoot: projectRoot,
      startupURLs: startupURLs,
      startupViewportWidth: startupViewportWidth,
      startupViewportHeight: startupViewportHeight,
      disableWorkspaceRestore: disableWorkspaceRestore,
      disableMCP: disableMCP
    )
  }
}

@MainActor
final class ProjectServerController {
  struct Configuration: Equatable {
    var projectRoot: URL
    var command: String
    var workingDirectory: URL
    var readyURL: URL?
    var environment: [String: String]
  }

  enum Status: String, Equatable {
    case stopped
    case starting
    case running
    case ready
    case stopping
    case failed

    var displayLabel: String {
      rawValue.capitalized
    }
  }

  struct State: Equatable {
    var status: Status = .stopped
    var pid: Int32?
    var lastExitCode: Int32?
    var lastError: String?
    var recentOutput: [String] = []
  }

  enum Event: Equatable {
    case started(command: String, pid: Int32)
    case ready(url: URL)
    case readinessTimedOut(url: URL?)
    case stopped(exitCode: Int32?, forced: Bool, wasRequested: Bool)
    case failed(message: String, exitCode: Int32?)
  }

  var onStateChange: ((State) -> Void)?
  var onEvent: ((Event) -> Void)?

  private(set) var state = State() {
    didSet {
      onStateChange?(state)
    }
  }

  private(set) var managedProcessGroupID: Int32?

  private let readyPollInterval: TimeInterval
  private let readyTimeout: TimeInterval
  private let terminateTimeout: TimeInterval
  private let urlSession: URLSession

  private var process: Process?
  private var outputPipe: Pipe?
  private var partialOutput = ""
  private var readyTimer: DispatchSourceTimer?
  private var readyDeadline: Date?
  private var readinessRequestInFlight = false
  private var stopTimeoutWorkItem: DispatchWorkItem?
  private var currentRunID = 0
  private var stopRequested = false
  private var forcedStop = false

  init(
    urlSession: URLSession = makeProjectServerURLSession(),
    readyPollInterval: TimeInterval = 0.5,
    readyTimeout: TimeInterval = 60,
    terminateTimeout: TimeInterval = 5
  ) {
    self.urlSession = urlSession
    self.readyPollInterval = readyPollInterval
    self.readyTimeout = readyTimeout
    self.terminateTimeout = terminateTimeout
  }

  @discardableResult
  func start(configuration: Configuration) -> Int32? {
    invalidate()

    currentRunID += 1
    let runID = currentRunID

    partialOutput = ""
    stopRequested = false
    forcedStop = false
    readinessRequestInFlight = false
    state = State(status: configuration.readyURL == nil ? .running : .starting)

    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", configuration.command]
    process.currentDirectoryURL = configuration.workingDirectory
    process.environment = configuration.environment
    process.standardOutput = pipe
    process.standardError = pipe

    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      Task { @MainActor in
        self?.handleOutputData(data, runID: runID)
      }
    }

    process.terminationHandler = { [weak self] terminatedProcess in
      let exitCode = terminatedProcess.terminationStatus
      Task { @MainActor in
        self?.handleProcessTermination(exitCode: exitCode, runID: runID)
      }
    }

    do {
      try process.run()
    } catch {
      pipe.fileHandleForReading.readabilityHandler = nil
      state.status = .failed
      state.pid = nil
      state.lastExitCode = nil
      state.lastError = "Could not start server: \(error.localizedDescription)"
      onEvent?(.failed(message: state.lastError ?? "Could not start server.", exitCode: nil))
      return nil
    }

    self.process = process
    self.outputPipe = pipe
    managedProcessGroupID = establishManagedProcessGroup(rootPID: process.processIdentifier)
    state.pid = process.processIdentifier
    state.lastExitCode = nil
    state.lastError = nil
    onEvent?(.started(command: configuration.command, pid: process.processIdentifier))

    if let readyURL = configuration.readyURL {
      startReadinessPolling(readyURL: readyURL, runID: runID)
    }

    return process.processIdentifier
  }

  func stop() {
    guard let process else {
      state.status = .stopped
      return
    }

    guard process.isRunning else {
      cleanupActiveRunResources(resetOutput: false)
      state.status = .stopped
      state.pid = nil
      return
    }

    stopRequested = true
    forcedStop = false
    state.status = .stopping
    stopReadinessPolling()
    stopTimeoutWorkItem?.cancel()

    let runID = currentRunID
    let rootPID = process.processIdentifier
    let processGroupID = managedProcessGroupID
    let stopWorkItem = DispatchWorkItem { [weak self] in
      Task { @MainActor in
        self?.forceStopIfNeeded(runID: runID, rootPID: rootPID, processGroupID: processGroupID)
      }
    }
    stopTimeoutWorkItem = stopWorkItem
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + terminateTimeout, execute: stopWorkItem)
    signalManagedServer(processGroupID: processGroupID, rootPID: rootPID, signal: SIGTERM)
  }

  @discardableResult
  func invalidate(waitForTermination: Bool = false) -> Bool {
    currentRunID += 1
    cleanupActiveRunResources(resetOutput: true)
    var fullyTerminated = true

    if let process {
      process.terminationHandler = nil
      if process.isRunning {
        let pid = process.processIdentifier
        let processGroupID = managedProcessGroupID
        signalManagedServer(processGroupID: processGroupID, rootPID: pid, signal: SIGTERM)
        if waitForTermination {
          fullyTerminated = waitForManagedServerExit(processGroupID: processGroupID, rootPID: pid, timeout: terminateTimeout)
          if !fullyTerminated {
            signalManagedServer(processGroupID: processGroupID, rootPID: pid, signal: SIGKILL)
            fullyTerminated = waitForManagedServerExit(processGroupID: processGroupID, rootPID: pid, timeout: 1)
          }
        } else {
          fullyTerminated = false
          DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.5) {
            signalManagedServer(processGroupID: processGroupID, rootPID: pid, signal: SIGKILL)
          }
        }
      }
    }

    process = nil
    managedProcessGroupID = nil
    outputPipe = nil
    partialOutput = ""
    readinessRequestInFlight = false
    stopRequested = false
    forcedStop = false
    state = State()
    return fullyTerminated
  }

  private func handleOutputData(_ data: Data, runID: Int) {
    guard runID == currentRunID else { return }
    guard !data.isEmpty else {
      outputPipe?.fileHandleForReading.readabilityHandler = nil
      flushPartialOutput()
      return
    }

    let chunk = String(decoding: data, as: UTF8.self)
    partialOutput.append(chunk)

    var nextLines: [String] = []
    while let newlineRange = partialOutput.range(of: "\n") {
      let rawLine = String(partialOutput[..<newlineRange.lowerBound])
      partialOutput.removeSubrange(partialOutput.startIndex..<newlineRange.upperBound)
      let line = rawLine.trimmingCharacters(in: .newlines)
      if !line.isEmpty {
        nextLines.append(line)
      }
    }

    appendLogLines(nextLines)
  }

  private func handleProcessTermination(exitCode: Int32, runID: Int) {
    guard runID == currentRunID else { return }

    flushPartialOutput()
    cleanupActiveRunResources(resetOutput: false)

    let wasRequested = stopRequested
    let wasForced = forcedStop
    let message = "Server exited with status \(exitCode)."

    process = nil
    managedProcessGroupID = nil
    outputPipe = nil
    stopRequested = false
    forcedStop = false

    state.pid = nil
    state.lastExitCode = exitCode

    if wasRequested {
      state.status = .stopped
      state.lastError = nil
      onEvent?(.stopped(exitCode: exitCode, forced: wasForced, wasRequested: true))
      return
    }

    if exitCode == 0 {
      state.status = .stopped
      state.lastError = nil
      onEvent?(.stopped(exitCode: exitCode, forced: false, wasRequested: false))
      return
    }

    state.status = .failed
    state.lastError = message
    onEvent?(.failed(message: message, exitCode: exitCode))
  }

  private func startReadinessPolling(readyURL: URL, runID: Int) {
    stopReadinessPolling()
    readyDeadline = Date().addingTimeInterval(readyTimeout)

    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + readyPollInterval, repeating: readyPollInterval)
    timer.setEventHandler { [weak self] in
      Task { @MainActor in
        self?.pollReadiness(readyURL: readyURL, runID: runID)
      }
    }
    readyTimer = timer
    timer.resume()
  }

  private func pollReadiness(readyURL: URL, runID: Int) {
    guard runID == currentRunID else { return }
    guard process?.isRunning == true else { return }
    guard state.status == .starting else { return }
    guard !readinessRequestInFlight else { return }

    if let readyDeadline, Date() >= readyDeadline {
      stopReadinessPolling()
      state.status = .running
      onEvent?(.readinessTimedOut(url: readyURL))
      return
    }

    readinessRequestInFlight = true
    var request = URLRequest(url: readyURL)
    request.httpMethod = "GET"
    request.timeoutInterval = min(max(readyPollInterval, 0.3), 2)

    urlSession.dataTask(with: request) { [weak self] _, response, _ in
      let isReadyResponse = response is HTTPURLResponse
      Task { @MainActor in
        guard let self else { return }
        self.readinessRequestInFlight = false
        guard runID == self.currentRunID else { return }
        guard self.process?.isRunning == true else { return }

        if isReadyResponse {
          self.stopReadinessPolling()
          self.state.status = .ready
          self.state.lastError = nil
          self.onEvent?(.ready(url: readyURL))
        }
      }
    }
    .resume()
  }

  private func stopReadinessPolling() {
    readyTimer?.cancel()
    readyTimer = nil
    readyDeadline = nil
    readinessRequestInFlight = false
  }

  private func forceStopIfNeeded(runID: Int, rootPID: Int32, processGroupID: Int32?) {
    guard runID == currentRunID else { return }
    guard let process, process.isRunning else { return }
    forcedStop = true
    signalManagedServer(processGroupID: processGroupID, rootPID: rootPID, signal: SIGKILL)
  }

  private func cleanupActiveRunResources(resetOutput: Bool) {
    stopReadinessPolling()
    stopTimeoutWorkItem?.cancel()
    stopTimeoutWorkItem = nil
    outputPipe?.fileHandleForReading.readabilityHandler = nil
    if resetOutput {
      partialOutput = ""
    }
  }

  private func flushPartialOutput() {
    let line = partialOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    partialOutput = ""
    appendLogLines(line.isEmpty ? [] : [line])
  }

  private func appendLogLines(_ lines: [String]) {
    guard !lines.isEmpty else { return }
    state.recentOutput.append(contentsOf: lines)
    if state.recentOutput.count > 200 {
      state.recentOutput = Array(state.recentOutput.suffix(200))
    }
  }
}

@MainActor
final class ViewportController: NSObject, ObservableObject, Identifiable, WKNavigationDelegate {
  @Published var label: String
  @Published var currentURLString: String
  @Published var pageTitle: String
  @Published var status: ViewportStatus
  @Published var frame: ViewportFrame
  @Published var hasVisibleLoginForm = false
  @Published var lastRefreshedAt: Date?
  @Published var canGoBack = false
  @Published var canGoForward = false
  @Published var lastErrorDescription: String?
  @Published private(set) var webView: WKWebView?

  let id: UUID

  var onChange: (() -> Void)?

  init(snapshot: ViewportSnapshot, autoload: Bool = true) {
    self.id = snapshot.id
    self.label = snapshot.label
    self.currentURLString = snapshot.urlString
    self.pageTitle = snapshot.label
    self.status = autoload ? snapshot.status : .restoring
    self.frame = snapshot.frame
    self.lastRefreshedAt = snapshot.lastRefreshedAt
    super.init()
    syncNavigationState()
    if autoload {
      ensureRuntimeAttached()
    }
  }

  var shouldShowPlaceholder: Bool {
    webView == nil || status == .restoring || status == .error || status == .disconnected
  }

  private func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
    let webView = FocusableViewportWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    return webView
  }

  func snapshot() -> ViewportSnapshot {
    ViewportSnapshot(
      id: id,
      label: label,
      urlString: currentURLString,
      frame: frame,
      status: status,
      lastRefreshedAt: lastRefreshedAt
    )
  }

  func navigate(to urlString: String) {
    currentURLString = urlString
    loadCurrentURL(status: .loading, reloadFromOrigin: false, preferWebViewReload: false)
  }

  func reload() {
    lastRefreshedAt = Date()
    loadCurrentURL(status: .refreshing, reloadFromOrigin: false, preferWebViewReload: true)
  }

  func refreshAfterEdit() {
    lastRefreshedAt = Date()
    loadCurrentURL(status: .refreshing, reloadFromOrigin: true, preferWebViewReload: true)
  }

  func goBack() {
    guard let webView else { return }
    guard webView.canGoBack else { return }
    status = .loading
    lastErrorDescription = nil
    webView.goBack()
    syncNavigationState()
    onChange?()
  }

  func goForward() {
    guard let webView else { return }
    guard webView.canGoForward else { return }
    status = .loading
    lastErrorDescription = nil
    webView.goForward()
    syncNavigationState()
    onChange?()
  }

  func syncNavigationState() {
    canGoBack = webView?.canGoBack ?? false
    canGoForward = webView?.canGoForward ?? false
  }

  func ensureRuntimeAttached() {
    if webView == nil {
      webView = makeWebView()
    }
    loadCurrentURL(status: status == .refreshing ? .refreshing : .loading, reloadFromOrigin: false, preferWebViewReload: false)
  }

  private func loadCurrentURL(
    status nextStatus: ViewportStatus,
    reloadFromOrigin: Bool,
    preferWebViewReload: Bool
  ) {
    if webView == nil {
      webView = makeWebView()
    }
    guard let webView else { return }

    let trimmedURL = currentURLString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedURL.isEmpty else {
      status = .error
      lastErrorDescription = "Viewport URL is empty."
      syncNavigationState()
      onChange?()
      return
    }
    guard let url = URL(string: trimmedURL) else {
      status = .error
      lastErrorDescription = "Invalid URL."
      syncNavigationState()
      onChange?()
      return
    }

    status = nextStatus
    lastErrorDescription = nil

    if preferWebViewReload, webView.url != nil {
      if reloadFromOrigin {
        webView.reloadFromOrigin()
      } else {
        webView.reload()
      }
    } else {
      webView.load(URLRequest(url: url))
    }
    syncNavigationState()
    onChange?()
  }

  func detectLoginForm() {
    guard let webView else { return }
    let script = """
    (() => {
      const usernameSelectors = [
        'input[autocomplete="username"]',
        'input[autocomplete="email"]',
        'input[type="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]',
        'input[name*="user" i]',
        'input[id*="user" i]',
        'input[placeholder*="user" i]',
        'input[name*="login" i]',
        'input[id*="login" i]',
        'input[placeholder*="login" i]',
        'input[type="text"]',
        'textarea',
      ];

      const isVisibleElement = (element) => {
        if (!element || element.hidden) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isEditable = (element) => element && !element.disabled && !element.readOnly;
      const passwords = Array.from(document.querySelectorAll('input[type="password"]'));
      const passwordField = passwords.find((field) => isVisibleElement(field) && isEditable(field));
      if (!passwordField) return false;

      const roots = [passwordField.form, document].filter(Boolean);
      for (const root of roots) {
        const usernameField = Array.from(root.querySelectorAll(usernameSelectors.join(','))).find((field) => {
          if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
          if (!isVisibleElement(field) || !isEditable(field)) return false;
          return !(field instanceof HTMLInputElement && field.type === 'hidden');
        });
        if (usernameField || passwordField) return true;
      }
      return false;
    })();
    """

    webView.evaluateJavaScript(script) { [weak self] value, _ in
      guard let self else { return }
      Task { @MainActor in
        self.hasVisibleLoginForm = (value as? Bool) ?? false
        self.onChange?()
      }
    }
  }

  func fillLogin(username: String, password: String, completion: @escaping (Bool) -> Void) {
    ensureRuntimeAttached()
    guard let webView else {
      completion(false)
      return
    }
    let escapedUsername = username
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    let escapedPassword = password
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")

    let script = """
    (() => {
      const usernameSelectors = [
        'input[autocomplete="username"]',
        'input[autocomplete="email"]',
        'input[type="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]',
        'input[name*="user" i]',
        'input[id*="user" i]',
        'input[placeholder*="user" i]',
        'input[name*="login" i]',
        'input[id*="login" i]',
        'input[placeholder*="login" i]',
        'input[type="text"]',
        'textarea',
      ];

      const isVisibleElement = (element) => {
        if (!element || element.hidden) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isEditable = (element) => element && !element.disabled && !element.readOnly;
      const passwords = Array.from(document.querySelectorAll('input[type="password"]'));
      const passwordField = passwords.find((field) => isVisibleElement(field) && isEditable(field));
      if (!passwordField) return false;

      const roots = [passwordField.form, document].filter(Boolean);
      let usernameField = null;
      for (const root of roots) {
        usernameField = Array.from(root.querySelectorAll(usernameSelectors.join(','))).find((field) => {
          if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
          if (!isVisibleElement(field) || !isEditable(field)) return false;
          return !(field instanceof HTMLInputElement && field.type === 'hidden');
        });
        if (usernameField) break;
      }

      const setValue = (field, value) => {
        if (!field) return;
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(field, value);
        } else {
          field.value = value;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };

      if (usernameField) {
        usernameField.focus();
        setValue(usernameField, "\(escapedUsername)");
      }

      passwordField.focus();
      setValue(passwordField, "\(escapedPassword)");
      return true;
    })();
    """

    webView.evaluateJavaScript(script) { value, _ in
      completion((value as? Bool) ?? false)
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    status = .loading
    lastErrorDescription = nil
    syncNavigationState()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageTitle = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? (webView.title ?? label)
      : label
    currentURLString = webView.url?.absoluteString ?? currentURLString
    status = .live
    lastErrorDescription = nil
    lastRefreshedAt = Date()
    syncNavigationState()
    detectLoginForm()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    status = .error
    lastErrorDescription = error.localizedDescription
    syncNavigationState()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    status = .error
    lastErrorDescription = error.localizedDescription
    syncNavigationState()
    onChange?()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    status = .disconnected
    lastErrorDescription = "The viewport process disconnected. Reload to recover."
    syncNavigationState()
    onChange?()
  }
}

final class FocusableViewportWebView: WKWebView {
  var onInteraction: (() -> Void)?

  override var acceptsFirstResponder: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    onInteraction?()
    if window?.firstResponder !== self {
      window?.makeFirstResponder(nil)
      window?.makeFirstResponder(self)
    }
    super.mouseDown(with: event)
  }
}

struct EmbeddedViewportWebView: NSViewRepresentable {
  @ObservedObject var controller: ViewportController
  var accessibilityIdentifier: String
  var onInteraction: (() -> Void)? = nil

  func makeNSView(context: Context) -> WKWebView {
    let webView = controller.webView ?? WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    webView.setAccessibilityIdentifier(accessibilityIdentifier)
    webView.setAccessibilityLabel(controller.label)
    (webView as? FocusableViewportWebView)?.onInteraction = onInteraction
    return webView
  }

  func updateNSView(_ nsView: WKWebView, context: Context) {
    nsView.setAccessibilityIdentifier(accessibilityIdentifier)
    nsView.setAccessibilityLabel(controller.label)
    (nsView as? FocusableViewportWebView)?.onInteraction = onInteraction
  }
}

struct ViewportRuntimePlaceholderView: View {
  @ObservedObject var controller: ViewportController
  var onRetry: () -> Void

  var body: some View {
    VStack(spacing: 12) {
      if controller.status == .restoring {
        ProgressView()
          .progressViewStyle(.circular)
      } else {
        Image(systemName: controller.status == .disconnected ? "wifi.slash" : "exclamationmark.triangle")
          .font(.system(size: 28, weight: .semibold))
          .foregroundStyle(controller.status == .disconnected ? Color.secondary : Color.orange)
      }

      VStack(spacing: 4) {
        Text(placeholderTitle)
          .font(.headline)
        Text(placeholderDetail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: 320)

      if controller.status != .restoring {
        Button(controller.status == .disconnected ? "Reconnect" : "Retry") {
          onRetry()
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.white.opacity(0.94))
  }

  private var placeholderTitle: String {
    switch controller.status {
    case .restoring:
      return "Restoring Viewport"
    case .disconnected:
      return "Viewport Disconnected"
    case .error:
      return "Viewport Error"
    case .loading:
      return "Loading"
    case .live:
      return "Live"
    case .refreshing:
      return "Refreshing"
    }
  }

  private var placeholderDetail: String {
    if let lastErrorDescription = controller.lastErrorDescription, !lastErrorDescription.isEmpty {
      return lastErrorDescription
    }
    switch controller.status {
    case .restoring:
      return "Loop Browser is restoring this saved viewport without blocking the rest of the workspace."
    case .disconnected:
      return "This viewport lost its web content process. Reload it to recover."
    case .error:
      return "This viewport hit a loading problem. You can retry it without affecting the rest of the app."
    case .loading, .live, .refreshing:
      return controller.currentURLString
    }
  }
}

struct CanvasInteractionSurface: NSViewRepresentable {
  var transform: CanvasTransform
  var hitMap: CanvasHitMap
  var onCanvasMouseDown: () -> Void
  var onPanChanged: (CGSize, CGSize) -> Void
  var onPanEnded: () -> Void
  var onScrollPan: (CGFloat, CGFloat) -> Void
  var onPinchZoom: (CGPoint, CGFloat) -> Void

  func makeNSView(context: Context) -> CanvasInteractionNSView {
    let view = CanvasInteractionNSView()
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.clear.cgColor
    view.setAccessibilityElement(true)
    view.setAccessibilityIdentifier("canvas-interaction-surface")
    return view
  }

  func updateNSView(_ nsView: CanvasInteractionNSView, context: Context) {
    nsView.router.transform = transform
    nsView.router.hitMap = hitMap
    nsView.router.onCanvasMouseDown = onCanvasMouseDown
    nsView.router.onPanChanged = onPanChanged
    nsView.router.onPanEnded = onPanEnded
    nsView.router.onScrollPan = onScrollPan
    nsView.router.onPinchZoom = onPinchZoom
  }
}

final class CanvasInputRouter {
  enum Interaction {
    case canvasPan(originViewportPoint: CGPoint, originCanvasOffset: CGSize)
  }

  var transform = CanvasTransform(scale: 1, offset: .zero)
  var hitMap = CanvasHitMap(transform: CanvasTransform(scale: 1, offset: .zero), viewports: [])

  var onCanvasMouseDown: (() -> Void)?
  var onPanChanged: ((CGSize, CGSize) -> Void)?
  var onPanEnded: (() -> Void)?
  var onScrollPan: ((CGFloat, CGFloat) -> Void)?
  var onPinchZoom: ((CGPoint, CGFloat) -> Void)?

  private var activeInteraction: Interaction?

  func shouldIntercept(_ viewportPoint: CGPoint) -> Bool {
    if case .emptyCanvas = hitMap.region(at: viewportPoint) {
      return true
    }
    return false
  }

  func mouseDown(at viewportPoint: CGPoint) {
    let region = hitMap.region(at: viewportPoint)
    nativeUITestDebugLog("CanvasInputRouter.mouseDown point=\(viewportPoint) region=\(String(describing: region))")
    guard case .emptyCanvas = region else {
      activeInteraction = nil
      return
    }

    onCanvasMouseDown?()
    activeInteraction = .canvasPan(
      originViewportPoint: viewportPoint,
      originCanvasOffset: transform.offset
    )
  }

  func mouseDragged(to viewportPoint: CGPoint) {
    switch activeInteraction {
    case .canvasPan(let originViewportPoint, let originCanvasOffset):
      let translation = CGSize(
        width: viewportPoint.x - originViewportPoint.x,
        height: viewportPoint.y - originViewportPoint.y
      )
      onPanChanged?(originCanvasOffset, translation)
    case .none:
      break
    }
  }

  func mouseUp() {
    switch activeInteraction {
    case .canvasPan:
      onPanEnded?()
    case .none:
      break
    }
    activeInteraction = nil
  }

  func scroll(at viewportPoint: CGPoint, deltaX: CGFloat, deltaY: CGFloat) {
    guard case .emptyCanvas = hitMap.region(at: viewportPoint) else { return }
    onScrollPan?(deltaX, deltaY)
  }

  func magnify(at viewportPoint: CGPoint, magnification: CGFloat) {
    guard case .emptyCanvas = hitMap.region(at: viewportPoint) else { return }
    onPinchZoom?(viewportPoint, 1 + magnification)
  }
}

final class CanvasInteractionNSView: NSView {
  let router = CanvasInputRouter()

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    router.shouldIntercept(point) ? self : nil
  }

  override func mouseDown(with event: NSEvent) {
    reclaimWindowInputFocus(preferredResponder: self)
    let point = convert(event.locationInWindow, from: nil)
    nativeUITestDebugLog("CanvasInteractionNSView.mouseDown locationInWindow=\(event.locationInWindow) converted=\(point)")
    router.mouseDown(at: point)
  }

  override func mouseDragged(with event: NSEvent) {
    router.mouseDragged(to: convert(event.locationInWindow, from: nil))
  }

  override func mouseUp(with event: NSEvent) {
    router.mouseUp()
  }

  override func scrollWheel(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let deltaMultiplier: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 10
    router.scroll(
      at: point,
      deltaX: event.scrollingDeltaX * deltaMultiplier,
      deltaY: event.scrollingDeltaY * deltaMultiplier
    )
  }

  override func magnify(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    router.magnify(at: point, magnification: event.magnification)
  }
}

@MainActor
final class ExternalMCPAssistantAdapter: ObservableObject, AssistantService {
  @Published var connectionInfo: MCPConnectionInfo?
  @Published var lastError: String?

  var modeName: String { "External Codex via MCP" }
  var statusSummary: String {
    if let lastError {
      return lastError
    }
    if let connectionInfo {
      return "Ready on \(connectionInfo.url)"
    }
    return "Starting local MCP server…"
  }
}

@MainActor
final class LoopBrowserModel: ObservableObject {
  struct PendingViewportSeed {
    var routeOrURL: String
    var label: String?
    var width: Double
    var height: Double
    var staggerIndex: Int
  }

  private enum WorkspaceRestoreLoadResult {
    case missing
    case restored(WorkspaceStateFile, [String])
    case quarantined(String, URL?)
  }

  @Published var projectRoot: URL?
  @Published var projectConfig: ProjectConfigFile = .default
  @Published var localCredentials: LocalAgentLoginFile.Credentials?
  @Published var viewports: [ViewportController] = []
  @Published var selectedViewportID: UUID?
  @Published var canvasScale: CGFloat = 1
  @Published var canvasOffset: CGSize = .zero
  @Published var canvasViewportSize: CGSize = .zero
  @Published var isInspectorCollapsed = false
  @Published var inspectorWidth: CGFloat = 340
  @Published var showProjectSettings = false
  @Published var actionLog: [ActionLogEntry] = []
  @Published var workspaceNotice: WorkspaceNotice?
  @Published var serverConfigurationError: String?
  @Published var projectServerState = ProjectServerController.State()

  let externalAssistant = ExternalMCPAssistantAdapter()
  let embeddedAssistant = EmbeddedCodexAssistantAdapter()

  private lazy var mcpServer = LocalMCPServer(model: self)
  private let projectServerController = ProjectServerController()
  private var pendingPersistWorkItem: DispatchWorkItem?
  private var pendingWorkspaceRestoreWorkItem: DispatchWorkItem?
  private var pendingViewportHydrationWorkItem: DispatchWorkItem?
  private var pendingStartupViewports: [PendingViewportSeed] = []
  private var localProjectConfig = LocalAgentLoginFile.default
  private var pendingServerRestartConfiguration: ProjectServerController.Configuration?
  private var willTerminateObserver: NSObjectProtocol?
  private let launchOptions = NativeLaunchOptions.current
  private let workspacePersistenceQueue = DispatchQueue(label: "dev.loopbrowser.workspace-persistence", qos: .utility)
  private var currentProjectSessionToken = UUID()
  private var lastHealthyCanvasTransform = CanvasTransform(scale: 1, offset: .zero)
  private var quarantinedWorkspaceRestoreURL: URL?

  private let minimumCanvasScale: CGFloat = CanvasInteractionMath.minimumCanvasScale
  private let maximumCanvasScale: CGFloat = CanvasInteractionMath.maximumCanvasScale
  private let minimumInspectorWidth: CGFloat = 280
  private let maximumInspectorWidth: CGFloat = 520

  init() {
    projectServerController.onStateChange = { [weak self] state in
      self?.projectServerState = state
    }
    projectServerController.onEvent = { [weak self] event in
      self?.handleProjectServerEvent(event)
    }
    willTerminateObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.willTerminateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.persistWorkspaceStateNow()
        self?.stopManagedProjectServerForTermination()
      }
    }
  }

  func startServices() {
    if !launchOptions.disableMCP {
      mcpServer.onConnectionInfo = { [weak self] connectionInfo in
        Task { @MainActor in
          self?.externalAssistant.connectionInfo = connectionInfo
        }
      }

      mcpServer.onError = { [weak self] message in
        Task { @MainActor in
          self?.externalAssistant.lastError = message
          self?.recordAction("MCP", detail: message, success: false)
        }
      }

      mcpServer.startIfNeeded()
    } else {
      externalAssistant.lastError = "MCP disabled for native test launch."
    }

    if projectRoot == nil, let projectRoot = launchOptions.projectRoot {
      openProject(at: projectRoot)
    }
  }

  func chooseProjectFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.prompt = "Open Project"
    if panel.runModal() == .OK, let url = panel.url {
      openProject(at: url)
    }
  }

  func openProject(at projectURL: URL) {
    persistWorkspaceStateNow()
    projectServerController.invalidate()
    pendingServerRestartConfiguration = nil
    pendingPersistWorkItem?.cancel()
    pendingWorkspaceRestoreWorkItem?.cancel()
    pendingViewportHydrationWorkItem?.cancel()
    currentProjectSessionToken = UUID()
    projectRoot = projectURL
    workspaceNotice = nil
    serverConfigurationError = nil
    quarantinedWorkspaceRestoreURL = nil
    pendingStartupViewports = []
    loadProjectConfig()
    loadLocalCredentials()
    reconcileManagedProjectServerIfNeeded(projectRoot: projectURL, reason: "project open")
    resetWorkspaceState()
    applyHealthyCanvasTransform()
    applyProjectIdentity()
    if launchOptions.disableWorkspaceRestore {
      seedInitialViewportsIfNeeded()
    } else {
      restoreWorkspaceStateAsync(projectRoot: projectURL, sessionToken: currentProjectSessionToken)
    }
    recordAction("Project", detail: "Opened \(projectURL.lastPathComponent)", success: true)
  }

  var projectRootPath: String {
    projectRoot?.path ?? "No project selected"
  }

  var configuredDefaultURL: String? {
    projectConfig.startup?.defaultUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var configuredServerCommand: String {
    projectConfig.startup?.server?.command.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  var configuredServerWorkingDirectory: String {
    projectConfig.startup?.server?.workingDirectory?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  var configuredServerReadyURL: String {
    projectConfig.startup?.server?.readyUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  var effectiveServerReadyURL: URL? {
    do {
      return try resolveConfiguredServerReadyURL(
        explicitReadyURL: configuredServerReadyURL,
        defaultURL: configuredDefaultURL
      )
    } catch {
      return nil
    }
  }

  var canStartProjectServer: Bool {
    !configuredServerCommand.isEmpty && [.stopped, .failed].contains(projectServerState.status)
  }

  var canStopProjectServer: Bool {
    [.starting, .running, .ready, .stopping].contains(projectServerState.status)
  }

  var canRestartProjectServer: Bool {
    !configuredServerCommand.isEmpty && projectRoot != nil && projectServerState.status != .stopping
  }

  var projectServerOutputPreview: String {
    let lines = Array(projectServerState.recentOutput.suffix(12))
    return lines.joined(separator: "\n")
  }

  var currentSessionSummary: SessionSummary? {
    guard let projectRoot else { return nil }
    return SessionSummary(
      sessionId: deriveProjectSessionSlug(projectRoot: projectRoot),
      projectRoot: projectRoot.path,
      projectName: projectRoot.lastPathComponent,
      defaultUrl: configuredDefaultURL ?? "",
      viewportCount: viewports.count
    )
  }

  func dismissWorkspaceNotice() {
    workspaceNotice = nil
  }

  private func clearRecoveryNoticeIfPresent() {
    guard workspaceNotice?.kind == .recovery else { return }
    workspaceNotice = nil
  }

  func retryWorkspaceRestore() {
    guard let projectRoot, let quarantinedWorkspaceRestoreURL else { return }
    workspaceNotice = nil
    resetWorkspaceState()
    applyHealthyCanvasTransform()
    restoreWorkspaceStateAsync(
      projectRoot: projectRoot,
      sessionToken: currentProjectSessionToken,
      sourceURL: quarantinedWorkspaceRestoreURL
    )
  }

  func resetSavedWorkspace() {
    guard let projectRoot else { return }
    pendingPersistWorkItem?.cancel()
    pendingWorkspaceRestoreWorkItem?.cancel()
    pendingViewportHydrationWorkItem?.cancel()

    try? FileManager.default.removeItem(at: workspaceStateURL(projectRoot: projectRoot))
    if let quarantinedWorkspaceRestoreURL, FileManager.default.fileExists(atPath: quarantinedWorkspaceRestoreURL.path) {
      try? FileManager.default.removeItem(at: quarantinedWorkspaceRestoreURL)
    }
    quarantinedWorkspaceRestoreURL = nil
    workspaceNotice = nil
    resetWorkspaceState()
    applyHealthyCanvasTransform()
    seedInitialViewportsIfNeeded()
    persistWorkspaceStateNow()
    recordAction("Project", detail: "Reset saved workspace state.", success: true)
  }

  private func seedInitialViewportsIfNeeded() {
    guard viewports.isEmpty else { return }
    if !launchOptions.startupURLs.isEmpty {
      pendingStartupViewports = launchOptions.startupURLs.enumerated().map { index, startupURL in
        PendingViewportSeed(
          routeOrURL: startupURL,
          label: index == 0 ? "Primary" : "Viewport \(index + 1)",
          width: launchOptions.startupViewportWidth ?? 1200,
          height: launchOptions.startupViewportHeight ?? 800,
          staggerIndex: index
        )
      }
      applyPendingStartupViewportsIfNeeded()
    } else if let defaultUrl = configuredDefaultURL, !defaultUrl.isEmpty {
      pendingStartupViewports = [
        PendingViewportSeed(
          routeOrURL: defaultUrl,
          label: "Home",
          width: 1200,
          height: 800,
          staggerIndex: 0
        ),
      ]
      applyPendingStartupViewportsIfNeeded()
    }
  }

  private func restoreWorkspaceStateAsync(
    projectRoot: URL,
    sessionToken: UUID,
    sourceURL: URL? = nil
  ) {
    pendingWorkspaceRestoreWorkItem?.cancel()
    let workspaceURL = sourceURL ?? workspaceStateURL(projectRoot: projectRoot)
    let canonicalWorkspaceURL = workspaceStateURL(projectRoot: projectRoot)

    let workItem = DispatchWorkItem { [projectRoot] in
      let result: WorkspaceRestoreLoadResult

      guard FileManager.default.fileExists(atPath: workspaceURL.path) else {
        result = .missing
        Task { @MainActor in
          self.finishWorkspaceRestore(result, projectRoot: projectRoot, sessionToken: sessionToken)
        }
        return
      }

      do {
        let data = try Data(contentsOf: workspaceURL)
        let decodedState = try JSONDecoder().decode(WorkspaceStateFile.self, from: data)
        let validation = validateWorkspaceStateForRestore(decodedState)
        switch validation.disposition {
        case .restored:
          result = .restored(validation.state ?? decodedState, validation.messages)
        case .quarantined:
          if workspaceURL == canonicalWorkspaceURL {
            let quarantineURL = self.quarantineWorkspaceStateFile(
              projectRoot: projectRoot,
              sourceURL: workspaceURL,
              replacementData: data
            )
            result = .quarantined(validation.messages.joined(separator: " "), quarantineURL)
          } else {
            result = .quarantined(validation.messages.joined(separator: " "), workspaceURL)
          }
        }
      } catch {
        if workspaceURL == canonicalWorkspaceURL {
          let quarantineURL = self.quarantineWorkspaceStateFile(
            projectRoot: projectRoot,
            sourceURL: workspaceURL,
            replacementData: nil
          )
          result = .quarantined("Could not decode saved workspace state: \(error.localizedDescription)", quarantineURL)
        } else {
          result = .quarantined("Could not decode saved workspace state: \(error.localizedDescription)", workspaceURL)
        }
      }

      Task { @MainActor in
        self.finishWorkspaceRestore(result, projectRoot: projectRoot, sessionToken: sessionToken)
      }
    }

    pendingWorkspaceRestoreWorkItem = workItem
    DispatchQueue.global(qos: .userInitiated).async(execute: workItem)
  }

  private func finishWorkspaceRestore(
    _ result: WorkspaceRestoreLoadResult,
    projectRoot: URL,
    sessionToken: UUID
  ) {
    guard sessionToken == currentProjectSessionToken else { return }
    guard self.projectRoot == projectRoot else { return }

    switch result {
    case .missing:
      seedInitialViewportsIfNeeded()
    case .restored(let state, let messages):
      clearRecoveryNoticeIfPresent()
      applyValidatedWorkspaceState(state, sessionToken: sessionToken)
      if !messages.isEmpty {
        recordAction("Project", detail: messages.joined(separator: " "), success: true)
      }
    case .quarantined(let reason, let quarantineURL):
      quarantinedWorkspaceRestoreURL = quarantineURL
      resetWorkspaceState()
      applyHealthyCanvasTransform()
      workspaceNotice = WorkspaceNotice(
        kind: .recovery,
        title: "Opened In Safe Mode",
        detail: reason,
        allowsRetryRestore: quarantineURL != nil,
        allowsResetSavedWorkspace: true
      )
      recordAction("Project", detail: "Skipped saved workspace and opened safely. \(reason)", success: false)
    }
  }

  private func applyValidatedWorkspaceState(_ state: WorkspaceStateFile, sessionToken: UUID) {
    canvasScale = CGFloat(state.canvasScale)
    canvasOffset = CGSize(width: state.canvasOffsetX, height: state.canvasOffsetY)
    isInspectorCollapsed = state.inspectorCollapsed ?? false
    inspectorWidth = CGFloat(state.inspectorWidth ?? 340)
    applyHealthyCanvasTransform()
    viewports = state.viewports.map { snapshot in
      let controller = ViewportController(snapshot: snapshot, autoload: false)
      attachViewport(controller, sessionToken: sessionToken)
      return controller
    }
    selectedViewportID = viewports.first?.id
    scheduleViewportHydration(sessionToken: sessionToken)
  }

  private func scheduleViewportHydration(sessionToken: UUID) {
    pendingViewportHydrationWorkItem?.cancel()
    let pendingIDs = viewports.map(\.id)
    hydrateViewportRuntimeQueue(pendingIDs, sessionToken: sessionToken)
  }

  private func hydrateViewportRuntimeQueue(_ pendingIDs: [UUID], sessionToken: UUID) {
    guard !pendingIDs.isEmpty else { return }
    let nextID = pendingIDs[0]
    let remainingIDs = Array(pendingIDs.dropFirst())
    let workItem = DispatchWorkItem { [weak self] in
      Task { @MainActor in
        guard let self else { return }
        guard sessionToken == self.currentProjectSessionToken else { return }
        if let controller = self.viewports.first(where: { $0.id == nextID }) {
          controller.ensureRuntimeAttached()
        }
        self.hydrateViewportRuntimeQueue(remainingIDs, sessionToken: sessionToken)
      }
    }
    pendingViewportHydrationWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: workItem)
  }

  nonisolated private func quarantineWorkspaceStateFile(
    projectRoot: URL,
    sourceURL: URL,
    replacementData: Data?
  ) -> URL? {
    let destinationURL = quarantinedWorkspaceStateURL(projectRoot: projectRoot)
    do {
      try FileManager.default.createDirectory(
        at: projectWorkspaceDirectory(projectRoot: projectRoot),
        withIntermediateDirectories: true
      )
      if let replacementData {
        try replacementData.write(to: destinationURL, options: .atomic)
        try? FileManager.default.removeItem(at: sourceURL)
      } else if FileManager.default.fileExists(atPath: sourceURL.path) {
        try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
      }
      return destinationURL
    } catch {
      return nil
    }
  }

  private func presentConfigurationNotice(title: String, detail: String) {
    workspaceNotice = WorkspaceNotice(
      kind: .configuration,
      title: title,
      detail: detail,
      allowsRetryRestore: false,
      allowsResetSavedWorkspace: false
    )
  }

  private func loadManagedProjectServerRecord(projectRoot: URL) -> ManagedProjectServerRecord? {
    let recordURL = managedProjectServerRecordURL(projectRoot: projectRoot)
    guard FileManager.default.fileExists(atPath: recordURL.path) else { return nil }

    do {
      let data = try Data(contentsOf: recordURL)
      return try JSONDecoder().decode(ManagedProjectServerRecord.self, from: data)
    } catch {
      try? FileManager.default.removeItem(at: recordURL)
      return nil
    }
  }

  private func persistManagedProjectServerRecord(
    configuration: ProjectServerController.Configuration,
    rootPID: Int32,
    processGroupID: Int32?
  ) {
    let record = ManagedProjectServerRecord(
      rootPID: rootPID,
      processGroupID: processGroupID,
      projectRootPath: configuration.projectRoot.path,
      command: configuration.command,
      workingDirectoryPath: configuration.workingDirectory.path,
      readyURL: configuration.readyURL?.absoluteString,
      startedAt: Date()
    )

    do {
      try FileManager.default.createDirectory(
        at: projectWorkspaceDirectory(projectRoot: configuration.projectRoot),
        withIntermediateDirectories: true
      )
      let data = try JSONEncoder.pretty.encode(record)
      try data.write(to: managedProjectServerRecordURL(projectRoot: configuration.projectRoot), options: .atomic)
    } catch {
      recordAction("Server", detail: "Could not persist managed server state: \(error.localizedDescription)", success: false)
    }
  }

  private func clearManagedProjectServerRecord(projectRoot: URL) {
    try? FileManager.default.removeItem(at: managedProjectServerRecordURL(projectRoot: projectRoot))
  }

  private func reconcileManagedProjectServerIfNeeded(projectRoot: URL, reason: String) {
    guard let record = loadManagedProjectServerRecord(projectRoot: projectRoot) else { return }

    let rootAlive = isProcessAlive(record.rootPID)
    let processGroupAlive = record.processGroupID.map(isProcessGroupAlive) ?? false
    if !rootAlive && !processGroupAlive {
      clearManagedProjectServerRecord(projectRoot: projectRoot)
      return
    }

    recordAction(
      "Server",
      detail: "Cleaning up stale managed server from \(reason) (PID \(record.rootPID)).",
      success: true
    )
    signalManagedServer(processGroupID: record.processGroupID, rootPID: record.rootPID, signal: SIGTERM)

    if !waitForManagedServerExit(processGroupID: record.processGroupID, rootPID: record.rootPID, timeout: 1.5) {
      signalManagedServer(processGroupID: record.processGroupID, rootPID: record.rootPID, signal: SIGKILL)
      _ = waitForManagedServerExit(processGroupID: record.processGroupID, rootPID: record.rootPID, timeout: 0.75)
    }

    if isProcessAlive(record.rootPID) || (record.processGroupID.map(isProcessGroupAlive) ?? false) {
      recordAction(
        "Server",
        detail: "Stale managed server PID \(record.rootPID) is still running after cleanup attempt.",
        success: false
      )
    } else {
      clearManagedProjectServerRecord(projectRoot: projectRoot)
    }
  }

  private func applyHealthyCanvasTransform() {
    guard canvasScale.isFinite, canvasScale > 0 else {
      canvasScale = lastHealthyCanvasTransform.scale
      canvasOffset = lastHealthyCanvasTransform.offset
      return
    }
    guard canvasOffset.width.isFinite, canvasOffset.height.isFinite else {
      canvasOffset = lastHealthyCanvasTransform.offset
      return
    }
    lastHealthyCanvasTransform = CanvasTransform(scale: canvasScale, offset: canvasOffset)
  }

  func startProjectServer() {
    guard let projectRoot else { return }
    reconcileManagedProjectServerIfNeeded(projectRoot: projectRoot, reason: "server start")
    guard let configuration = makeProjectServerConfiguration(recordErrors: true) else { return }
    serverConfigurationError = nil
    pendingServerRestartConfiguration = nil
    if let rootPID = projectServerController.start(configuration: configuration) {
      persistManagedProjectServerRecord(
        configuration: configuration,
        rootPID: rootPID,
        processGroupID: projectServerController.managedProcessGroupID
      )
    }
  }

  func stopProjectServer() {
    pendingServerRestartConfiguration = nil
    projectServerController.stop()
  }

  func restartProjectServer() {
    guard let projectRoot else { return }
    reconcileManagedProjectServerIfNeeded(projectRoot: projectRoot, reason: "server restart")
    guard let configuration = makeProjectServerConfiguration(recordErrors: true) else { return }
    serverConfigurationError = nil
    pendingServerRestartConfiguration = nil
    if [.stopped, .failed].contains(projectServerState.status) {
      if let rootPID = projectServerController.start(configuration: configuration) {
        persistManagedProjectServerRecord(
          configuration: configuration,
          rootPID: rootPID,
          processGroupID: projectServerController.managedProcessGroupID
        )
      }
      return
    }
    pendingServerRestartConfiguration = configuration
    projectServerController.stop()
  }

  private func makeProjectServerConfiguration(recordErrors: Bool) -> ProjectServerController.Configuration? {
    guard let projectRoot else { return nil }
    let command = configuredServerCommand.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !command.isEmpty else {
      if recordErrors {
        serverConfigurationError = "Set a server command in Project Settings before starting the project server."
        recordAction("Server", detail: serverConfigurationError ?? "Missing server command.", success: false)
      }
      return nil
    }

    do {
      let workingDirectory = try resolveProjectDirectoryURL(
        projectRoot: projectRoot,
        relativePath: configuredServerWorkingDirectory.isEmpty ? nil : configuredServerWorkingDirectory
      )
      let readyURL = try resolveConfiguredServerReadyURL(
        explicitReadyURL: configuredServerReadyURL,
        defaultURL: configuredDefaultURL
      )
      let environment = ProcessInfo.processInfo.environment.merging(localProjectConfig.server?.environment ?? [:]) { _, override in
        override
      }
      return ProjectServerController.Configuration(
        projectRoot: projectRoot,
        command: command,
        workingDirectory: workingDirectory,
        readyURL: readyURL,
        environment: environment
      )
    } catch {
      if recordErrors {
        serverConfigurationError = error.localizedDescription
        recordAction("Server", detail: error.localizedDescription, success: false)
      }
      return nil
    }
  }

  private func resolveConfiguredServerReadyURL(explicitReadyURL: String, defaultURL: String?) throws -> URL? {
    let trimmedExplicitReadyURL = explicitReadyURL.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedExplicitReadyURL.isEmpty {
      return try resolveHTTPReadyURL(trimmedExplicitReadyURL)
    }

    guard let defaultURL, !defaultURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }
    guard let url = try? resolveHTTPReadyURL(defaultURL) else {
      return nil
    }
    return url
  }

  private func handleProjectServerEvent(_ event: ProjectServerController.Event) {
    switch event {
    case .started(let command, let pid):
      serverConfigurationError = nil
      recordAction("Server", detail: "Started local server (PID \(pid)) with `\(command)`.", success: true)
    case .ready(let url):
      let reloadedCount = reloadViewportsMatchingServerOrigin(readyURL: url)
      let detail =
        reloadedCount > 0
        ? "Server ready at \(url.absoluteString). Reloaded \(reloadedCount) matching viewport(s)."
        : "Server ready at \(url.absoluteString)."
      recordAction("Server", detail: detail, success: true)
    case .readinessTimedOut(let url):
      if let url {
        recordAction(
          "Server",
          detail: "Server is running, but readiness polling timed out for \(url.absoluteString).",
          success: false
        )
      } else {
        recordAction("Server", detail: "Server is running without a readiness URL.", success: true)
      }
    case .stopped(let exitCode, let forced, let wasRequested):
      if let projectRoot {
        clearManagedProjectServerRecord(projectRoot: projectRoot)
      }
      let detail: String
      let success: Bool
      if wasRequested {
        detail =
          forced
          ? "Stopped local server after forcing termination (exit \(exitCode ?? 0))."
          : "Stopped local server (exit \(exitCode ?? 0))."
        success = true
      } else {
        detail = "Server exited on its own with status \(exitCode ?? 0)."
        success = false
      }
      recordAction("Server", detail: detail, success: success)

      if let pendingServerRestartConfiguration {
        let configuration = pendingServerRestartConfiguration
        self.pendingServerRestartConfiguration = nil
        if let rootPID = projectServerController.start(configuration: configuration) {
          persistManagedProjectServerRecord(
            configuration: configuration,
            rootPID: rootPID,
            processGroupID: projectServerController.managedProcessGroupID
          )
        }
      }
    case .failed(let message, _):
      if let projectRoot {
        clearManagedProjectServerRecord(projectRoot: projectRoot)
      }
      recordAction("Server", detail: message, success: false)
    }
  }

  private func stopManagedProjectServerForTermination() {
    _ = projectServerController.invalidate(waitForTermination: true)
  }

  private func reloadViewportsMatchingServerOrigin(readyURL: URL) -> Int {
    guard let readyOrigin = readyURL.loopOrigin else { return 0 }

    var reloadedCount = 0
    for viewport in viewports {
      guard let viewportOrigin = URL(string: viewport.currentURLString)?.loopOrigin else { continue }
      guard viewportOrigin == readyOrigin else { continue }
      if viewport.status == .error || viewport.status == .disconnected {
        viewport.navigate(to: viewport.currentURLString)
      } else {
        viewport.reload()
      }
      reloadedCount += 1
    }

    if reloadedCount > 0 {
      persistWorkspaceStateNow()
    }

    return reloadedCount
  }

  func activeViewport() -> ViewportController? {
    if let selectedViewportID {
      return viewports.first(where: { $0.id == selectedViewportID })
    }
    return viewports.first
  }

  func updateCanvasViewportSize(_ size: CGSize) {
    canvasViewportSize = size
    applyPendingStartupViewportsIfNeeded()
  }

  func toggleInspector() {
    setInspectorCollapsed(!isInspectorCollapsed)
  }

  func setInspectorCollapsed(_ collapsed: Bool) {
    guard isInspectorCollapsed != collapsed else { return }
    isInspectorCollapsed = collapsed
    persistWorkspaceStateNow()
  }

  func setInspectorWidth(_ width: CGFloat) {
    let clamped = min(max(width, minimumInspectorWidth), maximumInspectorWidth)
    guard abs(clamped - inspectorWidth) > 0.5 else { return }
    inspectorWidth = clamped
    scheduleWorkspacePersistence()
  }

  func visibleCanvasCenter(in size: CGSize? = nil) -> CGPoint {
    let viewportSize = size ?? canvasViewportSize
    return CanvasInteractionMath.visibleCanvasCenter(
      viewportSize: viewportSize,
      transform: CanvasTransform(scale: canvasScale, offset: canvasOffset)
    )
  }

  func canvasPoint(from viewportPoint: CGPoint) -> CGPoint {
    CanvasInteractionMath.canvasPoint(
      viewportPoint: viewportPoint,
      transform: CanvasTransform(scale: canvasScale, offset: canvasOffset)
    )
  }

  func canvasHitMap() -> CanvasHitMap {
    var orderedViewports = viewports
    if let selectedViewportID,
       let selectedIndex = orderedViewports.firstIndex(where: { $0.id == selectedViewportID }) {
      let selected = orderedViewports.remove(at: selectedIndex)
      orderedViewports.append(selected)
    }

    return CanvasHitMap(
      transform: CanvasTransform(scale: canvasScale, offset: canvasOffset),
      viewports: orderedViewports.map { viewport in
        CanvasHitViewport(id: viewport.id, frame: viewport.frame)
      },
      headerHeight: CanvasUI.headerHeight,
      headerTrailingPassthroughWidth: CanvasUI.headerTrailingPassthroughWidth,
      edgeHandleThickness: CanvasUI.edgeHandleThickness,
      edgeHandleLength: CanvasUI.edgeHandleLength,
      cornerHandleSize: CanvasUI.cornerHandleSize,
      handleOutset: CanvasUI.handleOutset
    )
  }

  func panCanvasByScroll(deltaX: CGFloat, deltaY: CGFloat) {
    let nextOffset = CanvasInteractionMath.pannedOffset(
      origin: canvasOffset,
      deltaX: deltaX,
      deltaY: deltaY
    )
    guard nextOffset.width.isFinite, nextOffset.height.isFinite else {
      canvasScale = lastHealthyCanvasTransform.scale
      canvasOffset = lastHealthyCanvasTransform.offset
      return
    }
    canvasOffset = nextOffset
    applyHealthyCanvasTransform()
    scheduleWorkspacePersistence()
  }

  func zoomIn() {
    zoomCanvas(around: canvasViewportCenter, zoomFactor: 1.15)
  }

  func zoomOut() {
    zoomCanvas(around: canvasViewportCenter, zoomFactor: 1 / 1.15)
  }

  func resetCanvasZoom() {
    guard canvasScale > 0 else { return }
    let anchor = CanvasInteractionMath.canvasPoint(
      viewportPoint: canvasViewportCenter,
      transform: CanvasTransform(scale: canvasScale, offset: canvasOffset)
    )
    canvasScale = 1
    canvasOffset = CGSize(
      width: canvasViewportCenter.x - anchor.x,
      height: canvasViewportCenter.y - anchor.y
    )
    applyHealthyCanvasTransform()
    scheduleWorkspacePersistence()
  }

  func zoomCanvas(
    around viewportPoint: CGPoint,
    zoomFactor: CGFloat,
    persistImmediately: Bool = false
  ) {
    let transform = CanvasInteractionMath.zoomedTransform(
      viewportPoint: viewportPoint,
      zoomFactor: zoomFactor,
      transform: CanvasTransform(scale: canvasScale, offset: canvasOffset),
      minimumScale: minimumCanvasScale,
      maximumScale: maximumCanvasScale
    )
    guard transform.scale.isFinite, transform.offset.width.isFinite, transform.offset.height.isFinite else {
      canvasScale = lastHealthyCanvasTransform.scale
      canvasOffset = lastHealthyCanvasTransform.offset
      return
    }
    canvasScale = transform.scale
    canvasOffset = transform.offset
    applyHealthyCanvasTransform()
    if persistImmediately {
      persistWorkspaceStateNow()
    } else {
      scheduleWorkspacePersistence()
    }
  }

  func panCanvas(from origin: CGSize, translation: CGSize) {
    let nextOffset = CanvasInteractionMath.pannedOffset(
      origin: origin,
      translation: translation
    )
    guard nextOffset.width.isFinite, nextOffset.height.isFinite else {
      canvasScale = lastHealthyCanvasTransform.scale
      canvasOffset = lastHealthyCanvasTransform.offset
      return
    }
    canvasOffset = nextOffset
    applyHealthyCanvasTransform()
  }

  func finishCanvasPan() {
    persistWorkspaceStateNow()
  }

  func selectViewport(_ viewportID: UUID?, syncKeyboardFocus: Bool = true) {
    selectedViewportID = viewportID
    guard syncKeyboardFocus else { return }
    self.syncKeyboardFocus(with: viewportID)
  }

  func updateViewportOrigin(viewportID: UUID, origin: CGPoint) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    var updatedFrame = viewport.frame
    updatedFrame.x = origin.x
    updatedFrame.y = origin.y
    viewport.frame = updatedFrame
    selectedViewportID = viewportID
  }

  func finishViewportMove(viewportID: UUID) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    selectedViewportID = viewportID
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Moved \(viewport.label)", success: true)
  }

  func applyViewportFrame(viewportID: UUID, frame: ViewportFrame) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    viewport.frame = frame
    selectedViewportID = viewportID
  }

  func finishViewportResize(viewportID: UUID) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    selectedViewportID = viewportID
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Resized \(viewport.label)", success: true)
  }

  private func syncKeyboardFocus(with viewportID: UUID?) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }

      guard let viewportID,
            let viewport = self.viewports.first(where: { $0.id == viewportID })
      else {
        (NSApp.keyWindow ?? NSApp.mainWindow)?.makeFirstResponder(nil)
        return
      }

      let window = viewport.webView?.window ?? NSApp.keyWindow ?? NSApp.mainWindow
      window?.makeFirstResponder(nil)
      if let webView = viewport.webView {
        window?.makeFirstResponder(webView)
      }
    }
  }

  func scheduleWorkspacePersistence() {
    pendingPersistWorkItem?.cancel()
    let sessionToken = currentProjectSessionToken
    let workItem = DispatchWorkItem { [weak self] in
      Task { @MainActor in
        self?.persistWorkspaceState(sessionToken: sessionToken, synchronously: false)
      }
    }
    pendingPersistWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: workItem)
  }

  func persistWorkspaceStateNow() {
    pendingPersistWorkItem?.cancel()
    persistWorkspaceState(sessionToken: currentProjectSessionToken, synchronously: true)
  }

  private func persistWorkspaceState(sessionToken: UUID, synchronously: Bool) {
    guard sessionToken == currentProjectSessionToken else { return }
    guard let snapshot = buildWorkspaceStateSnapshot(sessionToken: sessionToken) else { return }
    writeWorkspaceStateSnapshot(snapshot, synchronously: synchronously)
  }

  private func buildWorkspaceStateSnapshot(sessionToken: UUID) -> (sessionToken: UUID, projectRoot: URL, state: WorkspaceStateFile)? {
    guard let projectRoot else { return nil }
    let snapshot = WorkspaceStateFile(
      version: 1,
      canvasScale: Double(canvasScale),
      canvasOffsetX: canvasOffset.width,
      canvasOffsetY: canvasOffset.height,
      viewports: viewports.map { $0.snapshot() },
      inspectorCollapsed: isInspectorCollapsed,
      inspectorWidth: inspectorWidth
    )
    return (sessionToken, projectRoot, snapshot)
  }

  private func writeWorkspaceStateSnapshot(
    _ snapshot: (sessionToken: UUID, projectRoot: URL, state: WorkspaceStateFile),
    synchronously: Bool
  ) {
    let writeOperation: @Sendable () -> Void = { [snapshot] in
      do {
        try FileManager.default.createDirectory(
          at: projectWorkspaceDirectory(projectRoot: snapshot.projectRoot),
          withIntermediateDirectories: true
        )
        let data = try JSONEncoder.pretty.encode(snapshot.state)
        try data.write(to: workspaceStateURL(projectRoot: snapshot.projectRoot), options: .atomic)
      } catch {
        Task { @MainActor in
          guard snapshot.sessionToken == self.currentProjectSessionToken else { return }
          self.presentConfigurationNotice(
            title: "Could Not Save Workspace State",
            detail: error.localizedDescription
          )
        }
      }
    }

    if synchronously {
      workspacePersistenceQueue.sync(execute: writeOperation)
    } else {
      workspacePersistenceQueue.async(execute: writeOperation)
    }
  }

  func canUseAgentLogin(on viewport: ViewportController) -> Bool {
    guard let credentials = localCredentials else {
      return false
    }

    guard !credentials.username.isEmpty, !credentials.password.isEmpty else {
      return false
    }

    guard viewport.hasVisibleLoginForm else {
      return false
    }

    guard
      let configuredDefaultURL,
      let configuredOrigin = URL(string: configuredDefaultURL)?.loopOrigin,
      let currentOrigin = URL(string: viewport.currentURLString)?.loopOrigin
    else {
      return false
    }

    return configuredOrigin == currentOrigin
  }

  @discardableResult
  func addViewport(
    routeOrURL: String,
    label: String? = nil,
    width: Double = 1200,
    height: Double = 800,
    staggerIndex: Int = 0
  ) -> ViewportController? {
    guard let resolvedURL = resolveTargetURL(routeOrURL) else {
      let detail = "Could not resolve viewport URL from \(routeOrURL). Set Default URL or pass a full URL."
      presentConfigurationNotice(title: "Could Not Create Viewport", detail: detail)
      recordAction("Viewport", detail: detail, success: false)
      return nil
    }

    let frame = CanvasInteractionMath.spawnedViewportFrame(
      center: visibleCanvasCenter(),
      width: width,
      height: height,
      staggerIndex: staggerIndex
    )
    let snapshot = ViewportSnapshot(
      id: UUID(),
      label: label ?? "Viewport \(viewports.count + 1)",
      urlString: resolvedURL,
      frame: frame,
      status: .loading,
      lastRefreshedAt: nil
    )
    let controller = ViewportController(snapshot: snapshot)
    attachViewport(controller, sessionToken: currentProjectSessionToken)
    viewports.append(controller)
    selectedViewportID = controller.id
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Created \(controller.label) at \(resolvedURL)", success: true)
    return controller
  }

  func addViewports(definitions: [[String: Any]]) {
    for (index, definition) in definitions.enumerated() {
      let route = (definition["route"] as? String) ?? (definition["url"] as? String) ?? ""
      let label = definition["label"] as? String
      let width = definition["width"] as? Double ?? 1200
      let height = definition["height"] as? Double ?? 800
      _ = addViewport(routeOrURL: route, label: label, width: width, height: height, staggerIndex: index)
    }
  }

  func updateViewportRoute(viewportID: UUID, routeOrURL: String) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    guard let resolvedURL = resolveTargetURL(routeOrURL) else {
      recordAction("Viewport", detail: "Could not resolve updated route \(routeOrURL)", success: false)
      return
    }
    viewport.navigate(to: resolvedURL)
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Updated \(viewport.label) to \(resolvedURL)", success: true)
  }

  func updateViewportSize(viewportID: UUID, width: Double, height: Double) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    var updatedFrame = viewport.frame
    updatedFrame.width = max(320, width)
    updatedFrame.height = max(240, height)
    viewport.frame = updatedFrame
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Resized \(viewport.label) to \(Int(width))×\(Int(height))", success: true)
  }

  func closeViewport(viewportID: UUID) {
    guard let index = viewports.firstIndex(where: { $0.id == viewportID }) else { return }
    let viewport = viewports.remove(at: index)
    if selectedViewportID == viewport.id {
      selectedViewportID = viewports.first?.id
    }
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Closed \(viewport.label)", success: true)
  }

  func refreshViewport(viewportID: UUID) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    viewport.reload()
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Reloaded \(viewport.label)", success: true)
  }

  func refreshAllViewports() {
    for viewport in viewports {
      viewport.reload()
    }
    persistWorkspaceStateNow()
    recordAction("Viewport", detail: "Refreshed all live viewports", success: true)
  }

  func refreshAllViewportsAfterEdit(touchedFiles: [String]) {
    for viewport in viewports {
      viewport.refreshAfterEdit()
    }
    persistWorkspaceStateNow()
    recordAction(
      "Files",
      detail: "Edited \(touchedFiles.count) file(s) and refreshed all viewports.",
      success: true
    )
  }

  func setCanvasTransform(scale: CGFloat? = nil, offset: CGSize? = nil) {
    if let scale {
      guard scale.isFinite, scale > 0 else {
        canvasScale = lastHealthyCanvasTransform.scale
        canvasOffset = lastHealthyCanvasTransform.offset
        return
      }
      canvasScale = min(max(scale, minimumCanvasScale), maximumCanvasScale)
    }
    if let offset {
      guard offset.width.isFinite, offset.height.isFinite else {
        canvasScale = lastHealthyCanvasTransform.scale
        canvasOffset = lastHealthyCanvasTransform.offset
        return
      }
      canvasOffset = offset
    }
    applyHealthyCanvasTransform()
    persistWorkspaceStateNow()
  }

  func applyAgentLogin(to viewport: ViewportController) {
    guard let credentials = localCredentials else {
      recordAction("Login", detail: "No repo-local credentials are saved for this project.", success: false)
      return
    }
    viewport.fillLogin(username: credentials.username, password: credentials.password) { [weak self] success in
      Task { @MainActor in
        self?.recordAction(
          "Login",
          detail: success ? "Filled login form in \(viewport.label)." : "Could not fill login form in \(viewport.label).",
          success: success
        )
      }
    }
  }

  func saveProjectAppearance(
    defaultUrl: String,
    chromeColor: String,
    accentColor: String,
    projectIconPath: String,
    serverCommand: String? = nil,
    serverWorkingDirectory: String? = nil,
    serverReadyURL: String? = nil
  ) {
    guard let projectRoot else { return }

    let trimmedDefaultURL = defaultUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedDefaultURL: String?
    if trimmedDefaultURL.isEmpty {
      normalizedDefaultURL = nil
    } else {
      normalizedDefaultURL = try? normalizeAddress(trimmedDefaultURL)
    }

    let resolvedServerCommand = (serverCommand ?? configuredServerCommand)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedWorkingDirectory = (serverWorkingDirectory ?? configuredServerWorkingDirectory)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedReadyURL = (serverReadyURL ?? configuredServerReadyURL)
      .trimmingCharacters(in: .whitespacesAndNewlines)

    let nextServerConfig: ProjectConfigFile.Startup.Server?
    do {
      if resolvedServerCommand.isEmpty {
        guard resolvedWorkingDirectory.isEmpty, resolvedReadyURL.isEmpty else {
          throw NSError(domain: "LoopBrowserNative", code: 9, userInfo: [
            NSLocalizedDescriptionKey: "Enter a server command before saving server startup settings.",
          ])
        }
        nextServerConfig = nil
      } else {
        if !resolvedWorkingDirectory.isEmpty {
          _ = try resolveProjectDirectoryURL(projectRoot: projectRoot, relativePath: resolvedWorkingDirectory)
        }
        let normalizedReadyURL = resolvedReadyURL.isEmpty ? nil : try resolveHTTPReadyURL(resolvedReadyURL).absoluteString
        nextServerConfig = ProjectConfigFile.Startup.Server(
          command: resolvedServerCommand,
          workingDirectory: resolvedWorkingDirectory.isEmpty ? nil : resolvedWorkingDirectory,
          readyUrl: normalizedReadyURL
        )
      }
    } catch {
      presentConfigurationNotice(
        title: "Could Not Save Project Settings",
        detail: error.localizedDescription
      )
      recordAction("Project", detail: "Could not save .loop-browser.json: \(error.localizedDescription)", success: false)
      return
    }

    projectConfig = ProjectConfigFile(
      version: 1,
      chrome: ProjectConfigFile.Chrome(
        chromeColor: chromeColor.isHexColor ? chromeColor.uppercased() : projectConfig.chrome.chromeColor,
        accentColor: accentColor.isHexColor ? accentColor.uppercased() : projectConfig.chrome.accentColor,
        projectIconPath: projectIconPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          ? nil
          : projectIconPath.trimmingCharacters(in: .whitespacesAndNewlines)
      ),
      startup: ProjectConfigFile.Startup(defaultUrl: normalizedDefaultURL, server: nextServerConfig),
      agentLogin: projectConfig.agentLogin
    )

    do {
      try FileManager.default.createDirectory(
        at: projectWorkspaceDirectory(projectRoot: projectRoot),
        withIntermediateDirectories: true
      )
      let data = try JSONEncoder.pretty.encode(projectConfig)
      try data.write(to: projectConfigURL(projectRoot: projectRoot), options: .atomic)
      applyProjectIdentity()
      workspaceNotice = nil
      serverConfigurationError = nil
      recordAction("Project", detail: "Saved .loop-browser.json", success: true)
    } catch {
      presentConfigurationNotice(
        title: "Could Not Save Project Settings",
        detail: error.localizedDescription
      )
      recordAction("Project", detail: "Could not save .loop-browser.json: \(error.localizedDescription)", success: false)
    }
  }

  func saveLocalAgentLogin(username: String, password: String) {
    guard let projectRoot else { return }
    let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedUsername.isEmpty, !trimmedPassword.isEmpty else {
      presentConfigurationNotice(
        title: "Could Not Save Agent Login",
        detail: "Enter both an agent login username and password."
      )
      return
    }

    var payload = localProjectConfig
    payload.version = 1
    payload.agentLogin = LocalAgentLoginFile.Credentials(username: trimmedUsername, password: trimmedPassword)

    do {
      let data = try JSONEncoder.pretty.encode(payload)
      try data.write(to: localLoginURL(projectRoot: projectRoot), options: .atomic)
      ensureGitIgnoreEntry(projectRoot: projectRoot)
      localProjectConfig = payload
      localCredentials = payload.agentLogin
      workspaceNotice = nil
      recordAction("Login", detail: "Saved .loop-browser.local.json", success: true)
    } catch {
      presentConfigurationNotice(
        title: "Could Not Save Agent Login",
        detail: error.localizedDescription
      )
      recordAction("Login", detail: "Could not save .loop-browser.local.json: \(error.localizedDescription)", success: false)
    }
  }

  func clearLocalAgentLogin() {
    guard let projectRoot else { return }
    var payload = localProjectConfig
    payload.version = 1
    payload.agentLogin = nil

    do {
      if payload.server == nil {
        try? FileManager.default.removeItem(at: localLoginURL(projectRoot: projectRoot))
      } else {
        let data = try JSONEncoder.pretty.encode(payload)
        try data.write(to: localLoginURL(projectRoot: projectRoot), options: .atomic)
        ensureGitIgnoreEntry(projectRoot: projectRoot)
      }
      localProjectConfig = payload
    } catch {
      presentConfigurationNotice(
        title: "Could Not Update Agent Login",
        detail: error.localizedDescription
      )
      recordAction("Login", detail: "Could not update .loop-browser.local.json: \(error.localizedDescription)", success: false)
      return
    }
    localCredentials = nil
    recordAction("Login", detail: "Cleared .loop-browser.local.json", success: true)
  }

  func chromeAppearanceState() -> [String: Any] {
    [
      "projectRoot": projectRoot?.path ?? "",
      "chromeColor": projectConfig.chrome.chromeColor,
      "accentColor": projectConfig.chrome.accentColor,
      "projectIconPath": projectConfig.chrome.projectIconPath ?? "",
      "defaultUrl": configuredDefaultURL ?? "",
      "hasLocalLogin": localCredentials != nil,
    ]
  }

  func workspaceSummary() -> [String: Any] {
    [
      "session": currentSessionSummary.map { [
        "sessionId": $0.sessionId,
        "projectRoot": $0.projectRoot,
        "projectName": $0.projectName,
        "defaultUrl": $0.defaultUrl,
        "viewportCount": $0.viewportCount,
      ] } as Any,
      "viewports": viewports.map { viewport in
        [
          "id": viewport.id.uuidString,
          "label": viewport.label,
          "title": viewport.pageTitle,
          "url": viewport.currentURLString,
          "status": viewport.status.rawValue,
          "frame": [
            "x": viewport.frame.x,
            "y": viewport.frame.y,
            "width": viewport.frame.width,
            "height": viewport.frame.height,
          ],
          "hasVisibleLoginForm": viewport.hasVisibleLoginForm,
        ] as [String: Any]
      },
      "canvas": [
        "scale": canvasScale,
        "offsetX": canvasOffset.width,
        "offsetY": canvasOffset.height,
        "viewportWidth": canvasViewportSize.width,
        "viewportHeight": canvasViewportSize.height,
      ],
      "inspector": [
        "collapsed": isInspectorCollapsed,
        "width": inspectorWidth,
      ],
    ]
  }

  func editProjectFiles(writes: [[String: Any]], deletes: [String]) -> [String: Any] {
    guard let projectRoot else {
      return [
        "success": false,
        "error": "Open a project before editing files.",
      ]
    }

    var touchedFiles: [String] = []

    do {
      for write in writes {
        guard
          let path = write["path"] as? String,
          let contents = write["contents"] as? String
        else {
          continue
        }

        let targetURL = try resolveProjectFileURL(projectRoot: projectRoot, relativePath: path)
        try FileManager.default.createDirectory(
          at: targetURL.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try contents.write(to: targetURL, atomically: true, encoding: .utf8)
        touchedFiles.append(path)
      }

      for delete in deletes {
        let targetURL = try resolveProjectFileURL(projectRoot: projectRoot, relativePath: delete)
        try? FileManager.default.removeItem(at: targetURL)
        touchedFiles.append(delete)
      }

      refreshAllViewportsAfterEdit(touchedFiles: touchedFiles)
      return [
        "success": true,
        "touchedFiles": touchedFiles,
        "summary": "Edited \(touchedFiles.count) file(s).",
      ]
    } catch {
      recordAction("Files", detail: "Could not edit project files: \(error.localizedDescription)", success: false)
      return [
        "success": false,
        "error": error.localizedDescription,
        "touchedFiles": touchedFiles,
      ]
    }
  }

  private func resolveProjectFileURL(projectRoot: URL, relativePath: String) throws -> URL {
    let normalized = relativePath.replacingOccurrences(of: "\\", with: "/")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else {
      throw NSError(domain: "LoopBrowserNative", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "File paths must be non-empty.",
      ])
    }
    let candidate = projectRoot.appendingPathComponent(normalized).standardizedFileURL
    let rootPath = projectRoot.standardizedFileURL.path + "/"
    guard candidate.path.hasPrefix(rootPath) else {
      throw NSError(domain: "LoopBrowserNative", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "File edits must stay inside the current project root.",
      ])
    }
    return candidate
  }

  private func resolveTargetURL(_ routeOrURL: String) -> String? {
    let trimmed = routeOrURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return configuredDefaultURL
    }

    if trimmed.hasPrefix("/") {
      guard let configuredDefaultURL else {
        return nil
      }
      guard let base = URL(string: configuredDefaultURL) else {
        return nil
      }
      return URL(string: trimmed, relativeTo: base)?.absoluteURL.absoluteString
    }

    return try? normalizeAddress(trimmed)
  }

  private func attachViewport(_ controller: ViewportController, sessionToken: UUID) {
    controller.onChange = { [weak self, weak controller] in
      guard let self, let controller else { return }
      Task { @MainActor in
        guard sessionToken == self.currentProjectSessionToken else { return }
        guard self.viewports.contains(where: { $0.id == controller.id }) else { return }
        if controller.pageTitle != controller.label, !controller.pageTitle.isEmpty {
          controller.label = controller.pageTitle
        }
        self.scheduleWorkspacePersistence()
      }
    }
  }

  private func loadProjectConfig() {
    guard let projectRoot else { return }
    let configURL = projectConfigURL(projectRoot: projectRoot)
    guard FileManager.default.fileExists(atPath: configURL.path) else {
      projectConfig = .default
      return
    }

    do {
      let data = try Data(contentsOf: configURL)
      projectConfig = try JSONDecoder().decode(ProjectConfigFile.self, from: data)
    } catch {
      projectConfig = .default
      presentConfigurationNotice(
        title: "Project Settings Could Not Be Loaded",
        detail: "Could not load .loop-browser.json: \(error.localizedDescription)"
      )
    }
  }

  private func loadLocalCredentials() {
    guard let projectRoot else { return }
    let credentialsURL = localLoginURL(projectRoot: projectRoot)
    guard FileManager.default.fileExists(atPath: credentialsURL.path) else {
      localProjectConfig = .default
      localCredentials = nil
      return
    }

    do {
      let data = try Data(contentsOf: credentialsURL)
      localProjectConfig = try JSONDecoder().decode(LocalAgentLoginFile.self, from: data)
      localCredentials = localProjectConfig.agentLogin
    } catch {
      localProjectConfig = .default
      localCredentials = nil
      presentConfigurationNotice(
        title: "Local Project Settings Could Not Be Loaded",
        detail: "Could not load .loop-browser.local.json: \(error.localizedDescription)"
      )
    }
  }

  private func resetWorkspaceState() {
    pendingViewportHydrationWorkItem?.cancel()
    viewports = []
    selectedViewportID = nil
    canvasScale = 1
    canvasOffset = .zero
    isInspectorCollapsed = false
    inspectorWidth = 340
  }

  private func ensureGitIgnoreEntry(projectRoot: URL) {
    let gitIgnoreURL = projectRoot.appendingPathComponent(".gitignore")
    let existing = (try? String(contentsOf: gitIgnoreURL, encoding: .utf8)) ?? ""
    let lines = existing.split(separator: "\n").map(String.init)
    if lines.contains(".loop-browser.local.json") || lines.contains("/.loop-browser.local.json") {
      return
    }

    var next = existing
    if !next.isEmpty, !next.hasSuffix("\n") {
      next.append("\n")
    }
    next.append(".loop-browser.local.json\n")
    try? next.write(to: gitIgnoreURL, atomically: true, encoding: .utf8)
  }

  private func applyProjectIdentity() {
    guard let projectRoot else { return }
    if let iconURL = resolvedProjectIconURL(projectRoot: projectRoot, projectIconPath: projectConfig.chrome.projectIconPath),
       let image = NSImage(contentsOf: iconURL) {
      NSApp.applicationIconImage = image
    }
  }

  func recordAction(_ title: String, detail: String, success: Bool) {
    actionLog.insert(ActionLogEntry(title: title, detail: detail, success: success), at: 0)
    if actionLog.count > 80 {
      actionLog = Array(actionLog.prefix(80))
    }
  }

  private var canvasViewportCenter: CGPoint {
    CGPoint(x: canvasViewportSize.width / 2, y: canvasViewportSize.height / 2)
  }

  private func applyPendingStartupViewportsIfNeeded() {
    guard canvasViewportSize != .zero, viewports.isEmpty, !pendingStartupViewports.isEmpty else {
      return
    }

    let seeds = pendingStartupViewports
    pendingStartupViewports.removeAll()
    for seed in seeds {
      _ = addViewport(
        routeOrURL: seed.routeOrURL,
        label: seed.label,
        width: seed.width,
        height: seed.height,
        staggerIndex: seed.staggerIndex
      )
    }

    if let firstViewportID = viewports.first?.id {
      selectViewport(firstViewportID)
    }
  }
}

extension JSONEncoder {
  static var pretty: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }
}

struct WelcomeView: View {
  @EnvironmentObject private var model: LoopBrowserModel

  var body: some View {
    VStack(spacing: 24) {
      Text("Loop Browser")
        .font(.system(size: 40, weight: .bold, design: .rounded))
      Text("A native macOS workspace for local frontend design and implementation.")
        .font(.title3)
        .foregroundStyle(.secondary)
      Text("Open a local project to start arranging live viewports on the canvas, save project-scoped startup settings, and expose workspace actions through the local MCP bridge.")
        .multilineTextAlignment(.center)
        .frame(maxWidth: 720)
        .foregroundStyle(.secondary)
      HStack(spacing: 16) {
        Button("Open Project") {
          model.chooseProjectFolder()
        }
        .buttonStyle(.borderedProminent)
        Button("Project Settings") {
          model.showProjectSettings = true
        }
        .buttonStyle(.bordered)
        .disabled(model.projectRoot == nil)
        .accessibilityIdentifier("project-settings-open")
      }
      VStack(alignment: .leading, spacing: 12) {
        FeatureRow(title: "Project config parity", detail: "Reads and writes .loop-browser.json plus repo-local .loop-browser.local.json.")
        FeatureRow(title: "Canvas-first workspace", detail: "Arrange overlapping live WKWebView viewports with move, resize, refresh, and route updates.")
        FeatureRow(title: "External Codex path", detail: "Local MCP endpoint exposes workspace tools for external clients while embedded auth/chat stays a Phase 2 concern.")
      }
      .padding(20)
      .background(
        RoundedRectangle(cornerRadius: 24, style: .continuous)
          .fill(Color.white.opacity(0.72))
      )
    }
    .padding(40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      LinearGradient(
        colors: [
          Color(hex: model.projectConfig.chrome.chromeColor) ?? Color(red: 0.98, green: 0.98, blue: 0.99),
          (Color(hex: model.projectConfig.chrome.accentColor) ?? .blue).opacity(0.16),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    )
  }
}

struct FeatureRow: View {
  var title: String
  var detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.headline)
      Text(detail)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct RootWorkspaceView: View {
  @EnvironmentObject private var model: LoopBrowserModel

  var body: some View {
    Group {
      if model.projectRoot == nil {
        WelcomeView()
      } else {
        HStack(spacing: 0) {
          WorkspaceCanvasView()

          if !model.isInspectorCollapsed {
            InspectorResizeHandle()
            InspectorSidebar()
              .frame(width: model.inspectorWidth)
              .transition(.move(edge: .trailing).combined(with: .opacity))
          }
        }
        .animation(.spring(response: 0.24, dampingFraction: 0.92), value: model.isInspectorCollapsed)
      }
    }
    .sheet(isPresented: $model.showProjectSettings) {
      ProjectSettingsView()
        .environmentObject(model)
        .frame(minWidth: 680, minHeight: 620)
    }
  }
}

struct InspectorResizeHandle: View {
  @EnvironmentObject private var model: LoopBrowserModel
  @State private var widthOrigin: CGFloat?

  var body: some View {
    Rectangle()
      .fill(Color.black.opacity(0.06))
      .frame(width: 6)
      .overlay(Color.white.opacity(0.3).frame(width: 1))
      .contentShape(Rectangle())
      .gesture(
        DragGesture()
          .onChanged { value in
            if widthOrigin == nil {
              widthOrigin = model.inspectorWidth
            }
            guard let widthOrigin else { return }
            model.setInspectorWidth(widthOrigin - value.translation.width)
          }
          .onEnded { _ in
            widthOrigin = nil
            model.persistWorkspaceStateNow()
          }
      )
  }
}

struct WorkspaceCanvasView: View {
  @EnvironmentObject private var model: LoopBrowserModel

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceToolbar()
      if let workspaceNotice = model.workspaceNotice {
        WorkspaceNoticeBanner(notice: workspaceNotice)
      }
      GeometryReader { geometry in
        ZStack(alignment: .topLeading) {
          ZStack(alignment: .topLeading) {
            CanvasGridView()
            ForEach(Array(model.viewports.enumerated()), id: \.element.id) { index, viewport in
              ViewportCardView(controller: viewport, index: index)
                .position(
                  x: CGFloat(viewport.frame.x + viewport.frame.width / 2),
                  y: CGFloat(viewport.frame.y + viewport.frame.height / 2)
                )
                .zIndex(model.selectedViewportID == viewport.id ? 10 : 1)
            }
          }
          .frame(width: max(geometry.size.width * 10, 12000), height: max(geometry.size.height * 10, 9000), alignment: .topLeading)
          .scaleEffect(model.canvasScale, anchor: .topLeading)
          .offset(model.canvasOffset)

          CanvasInteractionSurface(
            transform: CanvasTransform(scale: model.canvasScale, offset: model.canvasOffset),
            hitMap: model.canvasHitMap(),
            onCanvasMouseDown: {
              model.selectViewport(nil)
            },
            onPanChanged: { origin, translation in
              model.panCanvas(from: origin, translation: translation)
            },
            onPanEnded: {
              model.finishCanvasPan()
            },
            onScrollPan: { deltaX, deltaY in
              model.panCanvasByScroll(deltaX: deltaX, deltaY: deltaY)
            },
            onPinchZoom: { point, zoomFactor in
              model.zoomCanvas(around: point, zoomFactor: zoomFactor)
            }
          )
          .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .clipped()
        .background(
          LinearGradient(
            colors: [
              Color(hex: model.projectConfig.chrome.chromeColor) ?? Color(red: 0.98, green: 0.98, blue: 0.99),
              (Color(hex: model.projectConfig.chrome.accentColor) ?? .blue).opacity(0.08),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .coordinateSpace(name: "canvasViewport")
        .onAppear {
          model.updateCanvasViewportSize(geometry.size)
        }
        .onChange(of: geometry.size) { newSize in
          model.updateCanvasViewportSize(newSize)
        }
      }
    }
  }
}

struct WorkspaceNoticeBanner: View {
  @EnvironmentObject private var model: LoopBrowserModel
  let notice: WorkspaceNotice

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: notice.kind == .recovery ? "shield.lefthalf.filled" : "exclamationmark.triangle.fill")
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(notice.kind == .recovery ? .orange : .red)
      VStack(alignment: .leading, spacing: 4) {
        Text(notice.title)
          .font(.subheadline.weight(.semibold))
        Text(notice.detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer()
      HStack(spacing: 8) {
        if notice.allowsRetryRestore {
          Button("Retry Restore") {
            model.retryWorkspaceRestore()
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .accessibilityIdentifier("workspace-retry-restore")
        }
        if notice.allowsResetSavedWorkspace {
          Button("Reset Saved Workspace") {
            model.resetSavedWorkspace()
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
          .accessibilityIdentifier("workspace-reset-saved-state")
        }
        Button("Dismiss") {
          model.dismissWorkspaceNotice()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .accessibilityIdentifier("workspace-dismiss-notice")
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 12)
    .background(
      RoundedRectangle(cornerRadius: 0, style: .continuous)
        .fill(Color.white.opacity(0.88))
    )
    .overlay {
      AccessibilityMarkerView(
        identifier: "workspace-notice-banner",
        label: notice.title,
        value: notice.detail
      )
    }
  }
}

struct WorkspaceToolbar: View {
  @EnvironmentObject private var model: LoopBrowserModel
  @State private var newViewportText = ""

  var body: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 2) {
        Text(model.projectRoot?.lastPathComponent ?? "Loop Browser")
          .font(.system(size: 20, weight: .semibold, design: .rounded))
        Text(model.projectRootPath)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      TextField("Route or URL", text: $newViewportText)
        .textFieldStyle(.roundedBorder)
        .frame(width: 260)
      Button("Add Viewport") {
        _ = model.addViewport(routeOrURL: newViewportText.isEmpty ? (model.configuredDefaultURL ?? "") : newViewportText)
        newViewportText = ""
      }
      .buttonStyle(.borderedProminent)
      Button {
        model.zoomOut()
      } label: {
        Label("Zoom Out", systemImage: "minus.magnifyingglass")
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("canvas-zoom-out")
      Button("Actual Size") {
        model.resetCanvasZoom()
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("canvas-zoom-reset")
      Button {
        model.zoomIn()
      } label: {
        Label("Zoom In", systemImage: "plus.magnifyingglass")
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("canvas-zoom-in")
      Button("Refresh All") {
        model.refreshAllViewports()
      }
      .buttonStyle(.bordered)
      Button {
        model.toggleInspector()
      } label: {
        Label(model.isInspectorCollapsed ? "Show Panel" : "Hide Panel", systemImage: "sidebar.right")
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("inspector-toggle")
      Button("Reset Saved Workspace") {
        model.resetSavedWorkspace()
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("workspace-reset-saved-state-toolbar")
      Button("Project Settings") {
        model.showProjectSettings = true
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("project-settings-open")
      Button("Open Project") {
        model.chooseProjectFolder()
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("open-project")
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 12)
    .background(.thinMaterial)
  }
}

struct CanvasGridView: View {
  var body: some View {
    GeometryReader { geometry in
      Canvas { context, size in
        let major = CGFloat(240)
        let minor = CGFloat(48)
        let majorColor = Color.black.opacity(0.08)
        let minorColor = Color.black.opacity(0.03)

        func drawGrid(spacing: CGFloat, color: Color, lineWidth: CGFloat) {
          var path = Path()
          stride(from: CGFloat(0), through: size.width, by: spacing).forEach { x in
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: size.height))
          }
          stride(from: CGFloat(0), through: size.height, by: spacing).forEach { y in
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width, y: y))
          }
          context.stroke(path, with: .color(color), lineWidth: lineWidth)
        }

        drawGrid(spacing: minor, color: minorColor, lineWidth: 0.5)
        drawGrid(spacing: major, color: majorColor, lineWidth: 1)
      }
      .frame(width: max(geometry.size.width * 3, 3200), height: max(geometry.size.height * 3, 2200))
    }
  }
}

struct ViewportCardView: View {
  @EnvironmentObject private var model: LoopBrowserModel
  @ObservedObject var controller: ViewportController
  @State private var headerDragOrigin: CGPoint?
  @State private var resizeOriginFrame: ViewportFrame?
  @State private var resizeHandleInProgress: ViewportResizeHandle?
  let index: Int

  var body: some View {
    VStack(spacing: 0) {
      header
      ZStack {
        if controller.shouldShowPlaceholder {
          ViewportRuntimePlaceholderView(controller: controller) {
            model.refreshViewport(viewportID: controller.id)
          }
          .frame(width: CGFloat(controller.frame.width), height: CGFloat(controller.frame.height - CanvasUI.headerHeight))
        } else {
          EmbeddedViewportWebView(
            controller: controller,
            accessibilityIdentifier: "viewport-native-web-\(index)",
            onInteraction: {
              model.selectViewport(controller.id)
            }
          )
            .frame(width: CGFloat(controller.frame.width), height: CGFloat(controller.frame.height - CanvasUI.headerHeight))
        }
        Color.clear
          .allowsHitTesting(false)
      }
    }
    .frame(width: CGFloat(controller.frame.width), height: CGFloat(controller.frame.height))
    .background(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(Color.white.opacity(0.96))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .strokeBorder(
          model.selectedViewportID == controller.id
            ? (Color(hex: model.projectConfig.chrome.accentColor) ?? .blue)
            : Color.black.opacity(0.08),
          lineWidth: model.selectedViewportID == controller.id ? 2 : 1
        )
    )
    .overlay(alignment: .top) { alignedResizeHandle(.top) }
    .overlay(alignment: .bottom) { alignedResizeHandle(.bottom) }
    .overlay(alignment: .leading) { alignedResizeHandle(.left) }
    .overlay(alignment: .trailing) { alignedResizeHandle(.right) }
    .overlay(alignment: .topLeading) { alignedResizeHandle(.topLeft) }
    .overlay(alignment: .topTrailing) { alignedResizeHandle(.topRight) }
    .overlay(alignment: .bottomLeading) { alignedResizeHandle(.bottomLeft) }
    .overlay(alignment: .bottomTrailing) { alignedResizeHandle(.bottomRight) }
    .overlay {
      AccessibilityMarkerView(
        identifier: "viewport-card-\(index)",
        label: controller.label,
        value: model.selectedViewportID == controller.id ? "selected" : "unselected"
      )
    }
    .shadow(color: Color.black.opacity(0.14), radius: 20, x: 0, y: 14)
    .accessibilityElement(children: .contain)
  }

  private var header: some View {
    HStack(spacing: 10) {
      HStack(spacing: 10) {
        Circle()
          .fill(statusColor)
          .frame(width: 10, height: 10)
        VStack(alignment: .leading, spacing: 2) {
          Text(controller.label)
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
          Text(controller.currentURLString)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .padding(.trailing, 18)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .leading) {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.black.opacity(0.001))
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
          .overlay(alignment: .leading) {
            HStack(spacing: 4) {
              Capsule(style: .continuous).fill(Color.black.opacity(0.12)).frame(width: 4, height: 20)
              Capsule(style: .continuous).fill(Color.black.opacity(0.12)).frame(width: 4, height: 20)
            }
            .padding(.leading, 6)
          }
          .allowsHitTesting(false)
      }
      .overlay {
        headerDragSurface
      }
      Spacer()
      if model.canUseAgentLogin(on: controller) {
        Button("Use Agent Login") {
          model.applyAgentLogin(to: controller)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }
      Button {
        controller.goBack()
      } label: {
        Image(systemName: "chevron.backward")
      }
      .buttonStyle(.plain)
      .disabled(!controller.canGoBack)
      Button {
        controller.goForward()
      } label: {
        Image(systemName: "chevron.forward")
      }
      .buttonStyle(.plain)
      .disabled(!controller.canGoForward)
      Button {
        model.refreshViewport(viewportID: controller.id)
      } label: {
        Image(systemName: "arrow.clockwise")
      }
      .buttonStyle(.plain)
      Button {
        model.closeViewport(viewportID: controller.id)
      } label: {
        Image(systemName: "xmark")
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(
      LinearGradient(
        colors: [
          Color(hex: model.projectConfig.chrome.chromeColor) ?? Color.white,
          (Color(hex: model.projectConfig.chrome.accentColor) ?? .blue).opacity(0.12),
        ],
        startPoint: .leading,
        endPoint: .trailing
      )
    )
    .contentShape(Rectangle())
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(controller.label) Header")
  }

  private func alignedResizeHandle(_ handle: ViewportResizeHandle) -> some View {
    resizeHandle(for: handle)
      .offset(handleOverlayOffset(for: handle))
  }

  private func resizeHandle(for handle: ViewportResizeHandle) -> some View {
    let accentColor = Color(hex: model.projectConfig.chrome.accentColor) ?? .blue

    return ZStack {
      RoundedRectangle(cornerRadius: 7, style: .continuous)
        .fill(.white.opacity(0.001))
      resizeIndicator(for: handle, accentColor: accentColor)
      DragCaptureSurface(
        identifier: "viewport-resize-\(handle.accessibilityName)-\(index)",
        label: "\(controller.label) \(handle.accessibilityName) Resize Handle",
        onPress: {
          reclaimWindowInputFocus()
          model.selectViewport(controller.id, syncKeyboardFocus: false)
        },
        onDragChanged: { translation in
          if resizeHandleInProgress != handle || resizeOriginFrame == nil {
            resizeHandleInProgress = handle
            resizeOriginFrame = controller.frame
          }
          guard resizeHandleInProgress == handle, let resizeOriginFrame else { return }
          let scale = max(Double(model.canvasScale), 0.0001)
          model.applyViewportFrame(
            viewportID: controller.id,
            frame: handle.resizedFrame(
              from: resizeOriginFrame,
              deltaX: Double(translation.width) / scale,
              deltaY: Double(translation.height) / scale,
              symmetric: false
            )
          )
        },
        onDragEnded: {
          guard resizeHandleInProgress == handle else { return }
          resizeOriginFrame = nil
          resizeHandleInProgress = nil
          model.finishViewportResize(viewportID: controller.id)
        }
      )
    }
    .frame(width: handleSize(for: handle).width, height: handleSize(for: handle).height)
  }

  private func resizeIndicator(for handle: ViewportResizeHandle, accentColor: Color) -> some View {
    Group {
      if handle.showsHorizontalIndicator {
        Capsule(style: .continuous)
          .fill(accentColor.opacity(0.88))
          .frame(width: 30, height: 4)
      } else if handle.showsVerticalIndicator {
        Capsule(style: .continuous)
          .fill(accentColor.opacity(0.88))
          .frame(width: 4, height: 30)
      } else {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .fill(accentColor.opacity(0.9))
          .frame(width: 14, height: 14)
          .overlay(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
              .strokeBorder(.white.opacity(0.8), lineWidth: 1)
          )
      }
    }
  }

  private func handleSize(for handle: ViewportResizeHandle) -> CGSize {
    let scale = max(model.canvasScale, 0.0001)
    let minimumScreenHitThickness: CGFloat = 18
    let adjustedThickness = max(CanvasUI.edgeHandleThickness, minimumScreenHitThickness / scale)
    let adjustedCorner = max(CanvasUI.cornerHandleSize, minimumScreenHitThickness / scale)

    switch handle {
    case .top, .bottom:
      return CGSize(width: 72, height: adjustedThickness)
    case .left, .right:
      return CGSize(width: adjustedThickness, height: 72)
    case .topLeft, .topRight, .bottomLeft, .bottomRight:
      return CGSize(width: adjustedCorner, height: adjustedCorner)
    }
  }

  private func handleOverlayOffset(for handle: ViewportResizeHandle) -> CGSize {
    switch handle {
    case .top:
      return CGSize(width: 0, height: -2)
    case .bottom:
      return CGSize(width: 0, height: 2)
    case .left:
      return CGSize(width: -2, height: 0)
    case .right:
      return CGSize(width: 2, height: 0)
    case .topLeft:
      return CGSize(width: -2, height: -2)
    case .topRight:
      return CGSize(width: 2, height: -2)
    case .bottomLeft:
      return CGSize(width: -2, height: 2)
    case .bottomRight:
      return CGSize(width: 2, height: 2)
    }
  }

  private var headerDragSurface: some View {
    let scale = max(model.canvasScale, 0.0001)
    let minimumScreenHitHeight: CGFloat = 32

    return DragCaptureSurface(
      identifier: "viewport-header-\(index)",
      label: "\(controller.label) Header",
      onPress: {
        reclaimWindowInputFocus()
        model.selectViewport(controller.id, syncKeyboardFocus: false)
      },
      onDragChanged: { translation in
        if headerDragOrigin == nil {
          headerDragOrigin = CGPoint(x: controller.frame.x, y: controller.frame.y)
        }
        guard let headerDragOrigin else { return }
        let scale = max(model.canvasScale, 0.0001)
        model.updateViewportOrigin(
          viewportID: controller.id,
          origin: CGPoint(
            x: headerDragOrigin.x + translation.width / scale,
            y: headerDragOrigin.y + translation.height / scale
          )
        )
      },
      onDragEnded: {
        headerDragOrigin = nil
        model.finishViewportMove(viewportID: controller.id)
      }
    )
    .frame(
      width: headerDragWidth,
      height: max(CanvasUI.headerHeight, minimumScreenHitHeight / scale),
      alignment: .leading
    )
  }

  private var headerDragWidth: CGFloat {
    let width = CGFloat(controller.frame.width)
    let minimumDragWidth: CGFloat = 140
    let reservedTrailingWidth = min(
      CanvasUI.headerTrailingPassthroughWidth,
      max(width - minimumDragWidth, 0)
    )
    return max(minimumDragWidth, width - reservedTrailingWidth)
  }

  private var statusColor: Color {
    switch controller.status {
    case .restoring:
      return .secondary
    case .loading:
      return .orange
    case .live:
      return .green
    case .refreshing:
      return .blue
    case .error:
      return .red
    case .disconnected:
      return .gray
    }
  }
}

struct InspectorSidebar: View {
  @EnvironmentObject private var model: LoopBrowserModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        assistantPanel
        projectPanel
        selectedViewportPanel
        actionLogPanel
      }
      .padding(18)
    }
    .background(.ultraThinMaterial)
    .overlay {
      AccessibilityMarkerView(
        identifier: "inspector-sidebar",
        label: "Inspector Sidebar"
      )
    }
  }

  private var assistantPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Assistant")
        .font(.headline)
      Text(model.externalAssistant.modeName)
        .font(.subheadline.weight(.semibold))
      Text(model.externalAssistant.statusSummary)
        .font(.caption)
        .foregroundStyle(.secondary)
      if let info = model.externalAssistant.connectionInfo {
        LabeledContent("Transport", value: info.url)
          .font(.caption)
        LabeledContent("Token", value: "\(info.token.prefix(4))…\(info.token.suffix(4))")
          .font(.caption)
        LabeledContent("Registration", value: info.registrationFile)
          .font(.caption2)
      }
      Text(model.embeddedAssistant.statusSummary)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .panelCard()
  }

  private var projectPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Project")
        .font(.headline)
      LabeledContent("Root", value: model.projectRootPath)
        .font(.caption)
      LabeledContent("Default URL", value: model.configuredDefaultURL ?? "Not set")
        .font(.caption)
      LabeledContent("Chrome", value: model.projectConfig.chrome.chromeColor)
        .font(.caption)
      LabeledContent("Accent", value: model.projectConfig.chrome.accentColor)
        .font(.caption)
      LabeledContent("Viewports", value: "\(model.viewports.count)")
        .font(.caption)
      Divider()
      Text("Local Server")
        .font(.subheadline.weight(.semibold))
      LabeledContent("Command", value: model.configuredServerCommand.isEmpty ? "Not set" : model.configuredServerCommand)
        .font(.caption)
      LabeledContent("Working Dir", value: model.configuredServerWorkingDirectory.isEmpty ? "." : model.configuredServerWorkingDirectory)
        .font(.caption)
      LabeledContent("Ready URL", value: model.effectiveServerReadyURL?.absoluteString ?? "Not set")
        .font(.caption)
      LabeledContent("Status", value: model.projectServerState.status.displayLabel)
        .font(.caption)
      Text(model.projectServerState.status.displayLabel)
        .font(.caption.weight(.semibold))
        .foregroundStyle(projectServerStatusColor)
        .accessibilityIdentifier("project-server-status")
      if let pid = model.projectServerState.pid {
        LabeledContent("PID", value: "\(pid)")
          .font(.caption)
      }
      if let exitCode = model.projectServerState.lastExitCode {
        LabeledContent("Last Exit", value: "\(exitCode)")
          .font(.caption)
      }
      HStack(spacing: 8) {
        Button("Start Server") {
          model.startProjectServer()
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .disabled(!model.canStartProjectServer)
        .accessibilityIdentifier("project-server-start")
        Button("Stop") {
          model.stopProjectServer()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!model.canStopProjectServer)
        .accessibilityIdentifier("project-server-stop")
        Button("Restart") {
          model.restartProjectServer()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!model.canRestartProjectServer)
        .accessibilityIdentifier("project-server-restart")
      }
      Button("Reset Saved Workspace") {
        model.resetSavedWorkspace()
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .accessibilityIdentifier("workspace-reset-saved-state-inspector")
      Group {
        if model.projectServerOutputPreview.isEmpty {
          Text(
            model.configuredServerCommand.isEmpty
              ? "Set Server Command in Project Settings to enable one-click startup."
              : "Server output will appear here after launch."
          )
          .foregroundStyle(.secondary)
        } else {
          Text(model.projectServerOutputPreview)
            .textSelection(.enabled)
            .accessibilityIdentifier("project-server-output")
        }
      }
      .font(.caption.monospaced())
      if let serverConfigurationError = model.serverConfigurationError {
        Text(serverConfigurationError)
          .font(.caption)
          .foregroundStyle(.red)
      }
      if let serverError = model.projectServerState.lastError {
        Text(serverError)
          .font(.caption)
          .foregroundStyle(.red)
      }
    }
    .panelCard()
  }

  private var projectServerStatusColor: Color {
    switch model.projectServerState.status {
    case .stopped:
      return .secondary
    case .starting:
      return .orange
    case .running:
      return .blue
    case .ready:
      return .green
    case .stopping:
      return .orange
    case .failed:
      return .red
    }
  }

  private var selectedViewportPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Selected Viewport")
        .font(.headline)
      if let viewport = model.activeViewport() {
        Text(viewport.label)
          .font(.subheadline.weight(.semibold))
        LabeledContent("URL", value: viewport.currentURLString)
          .font(.caption)
        LabeledContent("Status", value: viewport.status.rawValue)
          .font(.caption)
        LabeledContent(
          "Frame",
          value: "\(Int(viewport.frame.width))×\(Int(viewport.frame.height)) at \(Int(viewport.frame.x)), \(Int(viewport.frame.y))"
        )
        .font(.caption)
        if model.canUseAgentLogin(on: viewport) {
          Button("Use Agent Login") {
            model.applyAgentLogin(to: viewport)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
        }
      } else {
        Text("Select a viewport on the canvas to inspect it here.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .panelCard()
  }

  private var recentActionEntries: [ActionLogEntry] {
    Array(model.actionLog.prefix(16))
  }

  private var actionLogPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Action Log")
        .font(.headline)
      ActionLogEntriesView(entries: recentActionEntries)
    }
    .panelCard()
  }
}

struct ActionLogEntriesView: View {
  let entries: [ActionLogEntry]

  private var formattedEntries: String {
    entries.map { entry in
      let stamp = entry.timestamp.formatted(date: .omitted, time: .standard)
      let status = entry.success ? "OK" : "ERROR"
      return "[\(stamp)] \(status) \(entry.title)\n\(entry.detail)"
    }
    .joined(separator: "\n\n")
  }

  var body: some View {
    if entries.isEmpty {
      Text("Workspace actions will appear here.")
        .font(.caption)
        .foregroundStyle(.secondary)
    } else {
      Text(formattedEntries)
        .font(.caption.monospaced())
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
  }
}

struct ProjectSettingsView: View {
  @Environment(\.dismiss) private var dismiss
  @EnvironmentObject private var model: LoopBrowserModel

  @State private var defaultURL = ""
  @State private var chromeColor = ""
  @State private var accentColor = ""
  @State private var projectIconPath = ""
  @State private var serverCommand = ""
  @State private var serverWorkingDirectory = ""
  @State private var serverReadyURL = ""
  @State private var loginUsername = ""
  @State private var loginPassword = ""

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text("Project Settings")
            .font(.title2.weight(.semibold))
          Text("Preserve .loop-browser.json and .loop-browser.local.json semantics while working in the native shell.")
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button("Close") { dismiss() }
      }
      .padding(24)
      Divider()
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          settingsSection(
            title: "Project",
            subtitle: "Current project identity and persisted config files."
          ) {
            LabeledContent("Project Root", value: model.projectRootPath)
            if let projectRoot = model.projectRoot {
              LabeledContent("Config", value: projectConfigURL(projectRoot: projectRoot).path)
              LabeledContent("Repo-local Login", value: localLoginURL(projectRoot: projectRoot).path)
            }
          }

          settingsSection(
            title: "Appearance",
            subtitle: "Shareable settings saved in .loop-browser.json."
          ) {
            VStack(alignment: .leading, spacing: 10) {
              TextField("Default URL", text: $defaultURL)
                .textFieldStyle(.roundedBorder)
              HStack {
                TextField("Chrome Color (#RRGGBB)", text: $chromeColor)
                  .textFieldStyle(.roundedBorder)
                TextField("Accent Color (#RRGGBB)", text: $accentColor)
                  .textFieldStyle(.roundedBorder)
              }
              HStack {
                TextField("Project Icon Path (relative to project root)", text: $projectIconPath)
                  .textFieldStyle(.roundedBorder)
                Button("Choose Icon") {
                  chooseProjectIcon()
                }
              }
              HStack(spacing: 12) {
                swatch(color: chromeColor, label: "Chrome")
                swatch(color: accentColor, label: "Accent")
              }
            }
          }

          settingsSection(
            title: "Local Server",
            subtitle: "Shareable startup command saved in .loop-browser.json. Repo-local env overrides belong in .loop-browser.local.json."
          ) {
            VStack(alignment: .leading, spacing: 10) {
              TextField("Server Command", text: $serverCommand)
                .textFieldStyle(.roundedBorder)
              TextField("Working Directory (relative to project root)", text: $serverWorkingDirectory)
                .textFieldStyle(.roundedBorder)
              TextField("Ready URL (defaults to Default URL)", text: $serverReadyURL)
                .textFieldStyle(.roundedBorder)
              HStack(spacing: 10) {
                Button("Save Project Settings") {
                  model.saveProjectAppearance(
                    defaultUrl: defaultURL,
                    chromeColor: chromeColor,
                    accentColor: accentColor,
                    projectIconPath: projectIconPath,
                    serverCommand: serverCommand,
                    serverWorkingDirectory: serverWorkingDirectory,
                    serverReadyURL: serverReadyURL
                  )
                }
                .buttonStyle(.borderedProminent)
                Button("Start Server") {
                  model.startProjectServer()
                }
                .buttonStyle(.bordered)
                .disabled(!model.canStartProjectServer)
              }
              Text("Example commands: `bin/dev` for Rails or `/usr/bin/python3 -m http.server 3000` for a static site.")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }

          settingsSection(
            title: "Agent Login",
            subtitle: "Repo-local credentials saved in .loop-browser.local.json and used by Use Agent Login."
          ) {
            VStack(alignment: .leading, spacing: 10) {
              TextField("Agent login email or username", text: $loginUsername)
                .textFieldStyle(.roundedBorder)
              SecureField("Agent login password", text: $loginPassword)
                .textFieldStyle(.roundedBorder)
              HStack {
                Button("Save Login") {
                  model.saveLocalAgentLogin(username: loginUsername, password: loginPassword)
                  loginPassword = ""
                }
                .buttonStyle(.borderedProminent)
                Button("Clear Login") {
                  model.clearLocalAgentLogin()
                  loginPassword = ""
                }
                .buttonStyle(.bordered)
              }
              if let credentials = model.localCredentials {
                Text("Saved username: \(credentials.username)")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              } else {
                Text("No repo-local login saved yet.")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
          }
        }
        .padding(24)
      }
    }
    .onAppear {
      defaultURL = model.configuredDefaultURL ?? ""
      chromeColor = model.projectConfig.chrome.chromeColor
      accentColor = model.projectConfig.chrome.accentColor
      projectIconPath = model.projectConfig.chrome.projectIconPath ?? ""
      serverCommand = model.configuredServerCommand
      serverWorkingDirectory = model.configuredServerWorkingDirectory
      serverReadyURL = model.configuredServerReadyURL
      loginUsername = model.localCredentials?.username ?? ""
      loginPassword = ""
    }
  }

  private func settingsSection<Content: View>(
    title: String,
    subtitle: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.headline)
      Text(subtitle)
        .font(.caption)
        .foregroundStyle(.secondary)
      content()
    }
    .padding(20)
    .background(
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .fill(Color.white.opacity(0.88))
    )
  }

  private func swatch(color: String, label: String) -> some View {
    HStack(spacing: 8) {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color(hex: color) ?? .clear)
        .frame(width: 28, height: 28)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(Color.black.opacity(0.08), lineWidth: 1)
        )
      Text(label)
        .font(.caption)
    }
  }

  private func chooseProjectIcon() {
    guard let projectRoot = model.projectRoot else { return }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.allowsMultipleSelection = false
    panel.directoryURL = projectRoot
    if panel.runModal() == .OK, let url = panel.url {
      if let relative = try? projectRelativePath(projectRoot: projectRoot, fileURL: url) {
        projectIconPath = relative
      }
    }
  }
}

extension View {
  func panelCard() -> some View {
    self
      .padding(16)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(Color.white.opacity(0.78))
      )
  }
}

private extension ViewportResizeHandle {
  var accessibilityName: String {
    switch self {
    case .top:
      return "top"
    case .bottom:
      return "bottom"
    case .left:
      return "left"
    case .right:
      return "right"
    case .topLeft:
      return "top-left"
    case .topRight:
      return "top-right"
    case .bottomLeft:
      return "bottom-left"
    case .bottomRight:
      return "bottom-right"
    }
  }
}

@main
struct LoopBrowserNativeApp: App {
  @StateObject private var model = LoopBrowserModel()

  var body: some Scene {
    WindowGroup {
      RootWorkspaceView()
        .environmentObject(model)
        .task {
          activateNativeTestWindowIfNeeded()
          model.startServices()
        }
        .frame(minWidth: 1280, minHeight: 820)
    }
    .commands {
      CommandMenu("Canvas") {
        Button("Zoom In") {
          model.zoomIn()
        }
        .keyboardShortcut("+", modifiers: [.command])

        Button("Zoom Out") {
          model.zoomOut()
        }
        .keyboardShortcut("-", modifiers: [.command])

        Button("Actual Size") {
          model.resetCanvasZoom()
        }
        .keyboardShortcut("0", modifiers: [.command])
      }
    }
  }
}
