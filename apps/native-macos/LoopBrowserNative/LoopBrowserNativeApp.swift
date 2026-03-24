import AppKit
import CryptoKit
import SwiftUI
import WebKit

enum ViewportStatus: String, Codable, CaseIterable {
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
    var defaultUrl: String?
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

  var version: Int
  var agentLogin: Credentials
}

struct SessionSummary: Codable {
  var sessionId: String
  var projectRoot: String
  var projectName: String
  var defaultUrl: String
  var viewportCount: Int
}

struct ActionLogEntry: Identifiable, Hashable {
  let id = UUID()
  let timestamp = Date()
  let title: String
  let detail: String
  let success: Bool
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

  let id: UUID
  let webView: WKWebView

  var onChange: (() -> Void)?

  init(snapshot: ViewportSnapshot) {
    self.id = snapshot.id
    self.label = snapshot.label
    self.currentURLString = snapshot.urlString
    self.pageTitle = snapshot.label
    self.status = snapshot.status
    self.frame = snapshot.frame
    self.lastRefreshedAt = snapshot.lastRefreshedAt
    let configuration = WKWebViewConfiguration()
    configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
    self.webView = FocusableViewportWebView(frame: .zero, configuration: configuration)
    super.init()
    self.webView.navigationDelegate = self
    if let url = URL(string: snapshot.urlString) {
      self.webView.load(URLRequest(url: url))
      self.status = .loading
    } else {
      self.webView.loadHTMLString(Self.invalidURLHTML(snapshot.urlString), baseURL: nil)
      self.status = .error
    }
    syncNavigationState()
  }

  static func invalidURLHTML(_ value: String) -> String {
    """
    <!doctype html>
    <html>
      <body style="font-family: -apple-system; padding: 24px;">
        <h1>Invalid URL</h1>
        <p>\(value)</p>
      </body>
    </html>
    """
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
    guard let url = URL(string: urlString) else {
      webView.loadHTMLString(Self.invalidURLHTML(urlString), baseURL: nil)
      status = .error
      syncNavigationState()
      onChange?()
      return
    }

    status = .loading
    webView.load(URLRequest(url: url))
    syncNavigationState()
    onChange?()
  }

  func reload() {
    status = .refreshing
    lastRefreshedAt = Date()
    webView.reload()
    syncNavigationState()
    onChange?()
  }

  func refreshAfterEdit() {
    status = .refreshing
    lastRefreshedAt = Date()
    webView.reloadFromOrigin()
    syncNavigationState()
    onChange?()
  }

  func goBack() {
    guard webView.canGoBack else { return }
    status = .loading
    webView.goBack()
    syncNavigationState()
    onChange?()
  }

  func goForward() {
    guard webView.canGoForward else { return }
    status = .loading
    webView.goForward()
    syncNavigationState()
    onChange?()
  }

  func syncNavigationState() {
    canGoBack = webView.canGoBack
    canGoForward = webView.canGoForward
  }

  func detectLoginForm() {
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
    syncNavigationState()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageTitle = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? (webView.title ?? label)
      : label
    currentURLString = webView.url?.absoluteString ?? currentURLString
    status = .live
    lastRefreshedAt = Date()
    syncNavigationState()
    detectLoginForm()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    status = .error
    syncNavigationState()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    status = .error
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
    controller.webView.setAccessibilityIdentifier(accessibilityIdentifier)
    controller.webView.setAccessibilityLabel(controller.label)
    (controller.webView as? FocusableViewportWebView)?.onInteraction = onInteraction
    return controller.webView
  }

  func updateNSView(_ nsView: WKWebView, context: Context) {
    nsView.setAccessibilityIdentifier(accessibilityIdentifier)
    nsView.setAccessibilityLabel(controller.label)
    (nsView as? FocusableViewportWebView)?.onInteraction = onInteraction
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
  @Published var projectError: String?

  let externalAssistant = ExternalMCPAssistantAdapter()
  let embeddedAssistant = EmbeddedCodexAssistantAdapter()

  private lazy var mcpServer = LocalMCPServer(model: self)
  private var pendingPersistWorkItem: DispatchWorkItem?
  private var pendingStartupViewports: [PendingViewportSeed] = []
  private let launchOptions = NativeLaunchOptions.current

  private let minimumCanvasScale: CGFloat = CanvasInteractionMath.minimumCanvasScale
  private let maximumCanvasScale: CGFloat = CanvasInteractionMath.maximumCanvasScale
  private let minimumInspectorWidth: CGFloat = 280
  private let maximumInspectorWidth: CGFloat = 520

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
    projectRoot = projectURL
    projectError = nil
    pendingStartupViewports = []
    loadProjectConfig()
    loadLocalCredentials()
    if launchOptions.disableWorkspaceRestore {
      resetWorkspaceState()
    } else {
      loadWorkspaceState()
    }
    applyProjectIdentity()
    if viewports.isEmpty {
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
    recordAction("Project", detail: "Opened \(projectURL.lastPathComponent)", success: true)
  }

  var projectRootPath: String {
    projectRoot?.path ?? "No project selected"
  }

  var configuredDefaultURL: String? {
    projectConfig.startup?.defaultUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
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
    persistWorkspaceState()
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
    canvasOffset = CanvasInteractionMath.pannedOffset(
      origin: canvasOffset,
      deltaX: deltaX,
      deltaY: deltaY
    )
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
    canvasScale = transform.scale
    canvasOffset = transform.offset
    if persistImmediately {
      persistWorkspaceState()
    } else {
      scheduleWorkspacePersistence()
    }
  }

  func panCanvas(from origin: CGSize, translation: CGSize) {
    canvasOffset = CanvasInteractionMath.pannedOffset(
      origin: origin,
      translation: translation
    )
  }

  func finishCanvasPan() {
    persistWorkspaceState()
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
    persistWorkspaceState()
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
    persistWorkspaceState()
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

      let window = viewport.webView.window ?? NSApp.keyWindow ?? NSApp.mainWindow
      window?.makeFirstResponder(nil)
      window?.makeFirstResponder(viewport.webView)
    }
  }

  func scheduleWorkspacePersistence() {
    pendingPersistWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      Task { @MainActor in
        self?.persistWorkspaceState()
      }
    }
    pendingPersistWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: workItem)
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
      projectError = "Could not resolve viewport URL from \(routeOrURL). Set Default URL or pass a full URL."
      recordAction("Viewport", detail: projectError ?? "Could not resolve viewport URL.", success: false)
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
    attachViewport(controller)
    viewports.append(controller)
    selectedViewportID = controller.id
    persistWorkspaceState()
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
    persistWorkspaceState()
    recordAction("Viewport", detail: "Updated \(viewport.label) to \(resolvedURL)", success: true)
  }

  func updateViewportSize(viewportID: UUID, width: Double, height: Double) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    var updatedFrame = viewport.frame
    updatedFrame.width = max(320, width)
    updatedFrame.height = max(240, height)
    viewport.frame = updatedFrame
    persistWorkspaceState()
    recordAction("Viewport", detail: "Resized \(viewport.label) to \(Int(width))×\(Int(height))", success: true)
  }

  func closeViewport(viewportID: UUID) {
    guard let index = viewports.firstIndex(where: { $0.id == viewportID }) else { return }
    let viewport = viewports.remove(at: index)
    if selectedViewportID == viewport.id {
      selectedViewportID = viewports.first?.id
    }
    persistWorkspaceState()
    recordAction("Viewport", detail: "Closed \(viewport.label)", success: true)
  }

  func refreshViewport(viewportID: UUID) {
    guard let viewport = viewports.first(where: { $0.id == viewportID }) else { return }
    viewport.reload()
    persistWorkspaceState()
    recordAction("Viewport", detail: "Reloaded \(viewport.label)", success: true)
  }

  func refreshAllViewports() {
    for viewport in viewports {
      viewport.reload()
    }
    persistWorkspaceState()
    recordAction("Viewport", detail: "Refreshed all live viewports", success: true)
  }

  func refreshAllViewportsAfterEdit(touchedFiles: [String]) {
    for viewport in viewports {
      viewport.refreshAfterEdit()
    }
    persistWorkspaceState()
    recordAction(
      "Files",
      detail: "Edited \(touchedFiles.count) file(s) and refreshed all viewports.",
      success: true
    )
  }

  func setCanvasTransform(scale: CGFloat? = nil, offset: CGSize? = nil) {
    if let scale {
      canvasScale = min(max(scale, minimumCanvasScale), maximumCanvasScale)
    }
    if let offset {
      canvasOffset = offset
    }
    persistWorkspaceState()
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

  func saveProjectAppearance(defaultUrl: String, chromeColor: String, accentColor: String, projectIconPath: String) {
    guard let projectRoot else { return }

    let trimmedDefaultURL = defaultUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedDefaultURL: String?
    if trimmedDefaultURL.isEmpty {
      normalizedDefaultURL = nil
    } else {
      normalizedDefaultURL = try? normalizeAddress(trimmedDefaultURL)
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
      startup: ProjectConfigFile.Startup(defaultUrl: normalizedDefaultURL),
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
      recordAction("Project", detail: "Saved .loop-browser.json", success: true)
    } catch {
      projectError = error.localizedDescription
      recordAction("Project", detail: "Could not save .loop-browser.json: \(error.localizedDescription)", success: false)
    }
  }

  func saveLocalAgentLogin(username: String, password: String) {
    guard let projectRoot else { return }
    let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedUsername.isEmpty, !trimmedPassword.isEmpty else {
      projectError = "Enter both an agent login username and password."
      return
    }

    let payload = LocalAgentLoginFile(
      version: 1,
      agentLogin: LocalAgentLoginFile.Credentials(username: trimmedUsername, password: trimmedPassword)
    )

    do {
      let data = try JSONEncoder.pretty.encode(payload)
      try data.write(to: localLoginURL(projectRoot: projectRoot), options: .atomic)
      ensureGitIgnoreEntry(projectRoot: projectRoot)
      localCredentials = payload.agentLogin
      recordAction("Login", detail: "Saved .loop-browser.local.json", success: true)
    } catch {
      projectError = error.localizedDescription
      recordAction("Login", detail: "Could not save .loop-browser.local.json: \(error.localizedDescription)", success: false)
    }
  }

  func clearLocalAgentLogin() {
    guard let projectRoot else { return }
    do {
      try FileManager.default.removeItem(at: localLoginURL(projectRoot: projectRoot))
    } catch {
      // Ignore missing file.
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

  private func attachViewport(_ controller: ViewportController) {
    controller.onChange = { [weak self, weak controller] in
      guard let self, let controller else { return }
      Task { @MainActor in
        if controller.pageTitle != controller.label, !controller.pageTitle.isEmpty {
          controller.label = controller.pageTitle
        }
        self.persistWorkspaceState()
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
      projectError = "Could not load .loop-browser.json: \(error.localizedDescription)"
    }
  }

  private func loadLocalCredentials() {
    guard let projectRoot else { return }
    let credentialsURL = localLoginURL(projectRoot: projectRoot)
    guard FileManager.default.fileExists(atPath: credentialsURL.path) else {
      localCredentials = nil
      return
    }

    do {
      let data = try Data(contentsOf: credentialsURL)
      localCredentials = try JSONDecoder().decode(LocalAgentLoginFile.self, from: data).agentLogin
    } catch {
      localCredentials = nil
      projectError = "Could not load .loop-browser.local.json: \(error.localizedDescription)"
    }
  }

  private func loadWorkspaceState() {
    guard let projectRoot else { return }
    let stateURL = workspaceStateURL(projectRoot: projectRoot)
    guard FileManager.default.fileExists(atPath: stateURL.path) else {
      resetWorkspaceState()
      return
    }

    do {
      let data = try Data(contentsOf: stateURL)
      let state = try JSONDecoder().decode(WorkspaceStateFile.self, from: data)
      canvasScale = CGFloat(state.canvasScale)
      canvasOffset = CGSize(width: state.canvasOffsetX, height: state.canvasOffsetY)
      isInspectorCollapsed = state.inspectorCollapsed ?? false
      inspectorWidth = CGFloat(state.inspectorWidth ?? 340)
      viewports = state.viewports.map { snapshot in
        let controller = ViewportController(snapshot: snapshot)
        attachViewport(controller)
        return controller
      }
      selectedViewportID = viewports.first?.id
    } catch {
      resetWorkspaceState()
      projectError = "Could not load workspace state: \(error.localizedDescription)"
    }
  }

  private func resetWorkspaceState() {
    viewports = []
    selectedViewportID = nil
    canvasScale = 1
    canvasOffset = .zero
    isInspectorCollapsed = false
    inspectorWidth = 340
  }

  func persistWorkspaceState() {
    guard let projectRoot else { return }
    do {
      try FileManager.default.createDirectory(
        at: projectWorkspaceDirectory(projectRoot: projectRoot),
        withIntermediateDirectories: true
      )
      let state = WorkspaceStateFile(
        canvasScale: Double(canvasScale),
        canvasOffsetX: canvasOffset.width,
        canvasOffsetY: canvasOffset.height,
        viewports: viewports.map { $0.snapshot() },
        inspectorCollapsed: isInspectorCollapsed,
        inspectorWidth: inspectorWidth
      )
      let data = try JSONEncoder.pretty.encode(state)
      try data.write(to: workspaceStateURL(projectRoot: projectRoot), options: .atomic)
    } catch {
      projectError = error.localizedDescription
    }
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
            model.persistWorkspaceState()
          }
      )
  }
}

struct WorkspaceCanvasView: View {
  @EnvironmentObject private var model: LoopBrowserModel

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceToolbar()
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
      Button("Project Settings") {
        model.showProjectSettings = true
      }
      .buttonStyle(.bordered)
      Button("Open Project") {
        model.chooseProjectFolder()
      }
      .buttonStyle(.bordered)
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
        EmbeddedViewportWebView(
          controller: controller,
          accessibilityIdentifier: "viewport-native-web-\(index)",
          onInteraction: {
            model.selectViewport(controller.id)
          }
        )
          .frame(width: CGFloat(controller.frame.width), height: CGFloat(controller.frame.height - CanvasUI.headerHeight))
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
      if let error = model.projectError {
        Text(error)
          .font(.caption)
          .foregroundStyle(.red)
      }
    }
    .panelCard()
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
              Button("Save Appearance") {
                model.saveProjectAppearance(
                  defaultUrl: defaultURL,
                  chromeColor: chromeColor,
                  accentColor: accentColor,
                  projectIconPath: projectIconPath
                )
              }
              .buttonStyle(.borderedProminent)
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
