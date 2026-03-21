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

struct ViewportFrame: Codable, Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double
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

@MainActor
final class ViewportController: NSObject, ObservableObject, Identifiable, WKNavigationDelegate {
  @Published var label: String
  @Published var currentURLString: String
  @Published var pageTitle: String
  @Published var status: ViewportStatus
  @Published var frame: ViewportFrame
  @Published var hasVisibleLoginForm = false
  @Published var lastRefreshedAt: Date?

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
    self.webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    self.webView.navigationDelegate = self
    if let url = URL(string: snapshot.urlString) {
      self.webView.load(URLRequest(url: url))
      self.status = .loading
    } else {
      self.webView.loadHTMLString(Self.invalidURLHTML(snapshot.urlString), baseURL: nil)
      self.status = .error
    }
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
      onChange?()
      return
    }

    status = .loading
    webView.load(URLRequest(url: url))
    onChange?()
  }

  func reload() {
    status = .refreshing
    lastRefreshedAt = Date()
    webView.reload()
    onChange?()
  }

  func refreshAfterEdit() {
    status = .refreshing
    lastRefreshedAt = Date()
    webView.reloadFromOrigin()
    onChange?()
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
    onChange?()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageTitle = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? (webView.title ?? label)
      : label
    currentURLString = webView.url?.absoluteString ?? currentURLString
    status = .live
    lastRefreshedAt = Date()
    detectLoginForm()
    onChange?()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    status = .error
    onChange?()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    status = .error
    onChange?()
  }
}

struct EmbeddedViewportWebView: NSViewRepresentable {
  @ObservedObject var controller: ViewportController

  func makeNSView(context: Context) -> WKWebView {
    controller.webView
  }

  func updateNSView(_ nsView: WKWebView, context: Context) {}
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
  @Published var projectRoot: URL?
  @Published var projectConfig: ProjectConfigFile = .default
  @Published var localCredentials: LocalAgentLoginFile.Credentials?
  @Published var viewports: [ViewportController] = []
  @Published var selectedViewportID: UUID?
  @Published var canvasScale: CGFloat = 1
  @Published var canvasOffset: CGSize = .zero
  @Published var showProjectSettings = false
  @Published var actionLog: [ActionLogEntry] = []
  @Published var projectError: String?

  let externalAssistant = ExternalMCPAssistantAdapter()
  let embeddedAssistant = EmbeddedCodexAssistantAdapter()

  private lazy var mcpServer = LocalMCPServer(model: self)

  func startServices() {
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
    loadProjectConfig()
    loadLocalCredentials()
    loadWorkspaceState()
    applyProjectIdentity()
    if viewports.isEmpty, let defaultUrl = configuredDefaultURL, !defaultUrl.isEmpty {
      _ = addViewport(routeOrURL: defaultUrl, label: "Home", width: 1200, height: 800)
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
    height: Double = 800
  ) -> ViewportController? {
    guard let resolvedURL = resolveTargetURL(routeOrURL) else {
      projectError = "Could not resolve viewport URL from \(routeOrURL). Set Default URL or pass a full URL."
      recordAction("Viewport", detail: projectError ?? "Could not resolve viewport URL.", success: false)
      return nil
    }

    let index = viewports.count
    let frame = ViewportFrame(
      x: 120 + Double(index % 3) * 40 + Double(index) * 24,
      y: 120 + Double(index / 3) * 40,
      width: width,
      height: height
    )
    let snapshot = ViewportSnapshot(
      id: UUID(),
      label: label ?? "Viewport \(index + 1)",
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
    for definition in definitions {
      let route = (definition["route"] as? String) ?? (definition["url"] as? String) ?? ""
      let label = definition["label"] as? String
      let width = definition["width"] as? Double ?? 1200
      let height = definition["height"] as? Double ?? 800
      _ = addViewport(routeOrURL: route, label: label, width: width, height: height)
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
    viewport.frame.width = max(320, width)
    viewport.frame.height = max(240, height)
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
      canvasScale = min(max(scale, 0.5), 2.0)
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
      viewports = []
      canvasScale = 1
      canvasOffset = .zero
      return
    }

    do {
      let data = try Data(contentsOf: stateURL)
      let state = try JSONDecoder().decode(WorkspaceStateFile.self, from: data)
      canvasScale = CGFloat(state.canvasScale)
      canvasOffset = CGSize(width: state.canvasOffsetX, height: state.canvasOffsetY)
      viewports = state.viewports.map { snapshot in
        let controller = ViewportController(snapshot: snapshot)
        attachViewport(controller)
        return controller
      }
      selectedViewportID = viewports.first?.id
    } catch {
      viewports = []
      canvasScale = 1
      canvasOffset = .zero
      projectError = "Could not load workspace state: \(error.localizedDescription)"
    }
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
        viewports: viewports.map { $0.snapshot() }
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
        HSplitView {
          WorkspaceCanvasView()
          InspectorSidebar()
            .frame(minWidth: 320, idealWidth: 340, maxWidth: 380)
        }
      }
    }
    .sheet(isPresented: $model.showProjectSettings) {
      ProjectSettingsView()
        .environmentObject(model)
        .frame(minWidth: 680, minHeight: 620)
    }
  }
}

struct WorkspaceCanvasView: View {
  @EnvironmentObject private var model: LoopBrowserModel
  @State private var canvasDragOrigin: CGSize = .zero
  @State private var canvasScaleOrigin: CGFloat = 1

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceToolbar()
      GeometryReader { geometry in
        ZStack(alignment: .topLeading) {
          CanvasGridView()
            .contentShape(Rectangle())
            .gesture(
              DragGesture()
                .onChanged { value in
                  if canvasDragOrigin == .zero {
                    canvasDragOrigin = model.canvasOffset
                  }
                  model.canvasOffset = CGSize(
                    width: canvasDragOrigin.width + value.translation.width,
                    height: canvasDragOrigin.height + value.translation.height
                  )
                }
                .onEnded { _ in
                  canvasDragOrigin = .zero
                  model.persistWorkspaceState()
                }
            )
            .simultaneousGesture(
              MagnificationGesture()
                .onChanged { value in
                  if canvasScaleOrigin == 1 {
                    canvasScaleOrigin = model.canvasScale
                  }
                  model.canvasScale = min(max(canvasScaleOrigin * value, 0.5), 2.0)
                }
                .onEnded { _ in
                  canvasScaleOrigin = 1
                  model.persistWorkspaceState()
                }
            )

          ZStack(alignment: .topLeading) {
            ForEach(model.viewports) { viewport in
              ViewportCardView(controller: viewport)
                .position(
                  x: CGFloat(viewport.frame.x + viewport.frame.width / 2),
                  y: CGFloat(viewport.frame.y + viewport.frame.height / 2)
                )
                .zIndex(model.selectedViewportID == viewport.id ? 10 : 1)
                .onTapGesture {
                  model.selectedViewportID = viewport.id
                }
            }
          }
          .frame(width: max(geometry.size.width * 3, 3200), height: max(geometry.size.height * 3, 2200), alignment: .topLeading)
          .scaleEffect(model.canvasScale, anchor: .topLeading)
          .offset(model.canvasOffset)
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
      Button("Refresh All") {
        model.refreshAllViewports()
      }
      .buttonStyle(.bordered)
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
  @State private var dragOrigin: ViewportFrame?
  @State private var resizeOrigin: ViewportFrame?

  var body: some View {
    VStack(spacing: 0) {
      header
      ZStack(alignment: .bottomTrailing) {
        EmbeddedViewportWebView(controller: controller)
          .frame(width: CGFloat(controller.frame.width), height: CGFloat(controller.frame.height - 46))
        resizeHandle
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
    .shadow(color: Color.black.opacity(0.14), radius: 20, x: 0, y: 14)
  }

  private var header: some View {
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
      Spacer()
      if model.canUseAgentLogin(on: controller) {
        Button("Use Agent Login") {
          model.applyAgentLogin(to: controller)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }
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
    .gesture(
      DragGesture()
        .onChanged { value in
          if dragOrigin == nil {
            dragOrigin = controller.frame
          }
          guard let origin = dragOrigin else { return }
          controller.frame.x = origin.x + Double(value.translation.width / model.canvasScale)
          controller.frame.y = origin.y + Double(value.translation.height / model.canvasScale)
        }
        .onEnded { _ in
          dragOrigin = nil
          model.selectedViewportID = controller.id
          model.persistWorkspaceState()
          model.recordAction("Viewport", detail: "Moved \(controller.label)", success: true)
        }
    )
  }

  private var resizeHandle: some View {
    RoundedRectangle(cornerRadius: 8, style: .continuous)
      .fill((Color(hex: model.projectConfig.chrome.accentColor) ?? .blue).opacity(0.88))
      .frame(width: 18, height: 18)
      .overlay(
        Image(systemName: "arrow.up.left.and.arrow.down.right")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(.white)
      )
      .padding(10)
      .contentShape(Rectangle())
      .gesture(
        DragGesture()
          .onChanged { value in
            if resizeOrigin == nil {
              resizeOrigin = controller.frame
            }
            guard let origin = resizeOrigin else { return }
            controller.frame.width = max(320, origin.width + Double(value.translation.width / model.canvasScale))
            controller.frame.height = max(240, origin.height + Double(value.translation.height / model.canvasScale))
          }
          .onEnded { _ in
            resizeOrigin = nil
            model.persistWorkspaceState()
            model.recordAction("Viewport", detail: "Resized \(controller.label)", success: true)
          }
      )
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

@main
struct LoopBrowserNativeApp: App {
  @StateObject private var model = LoopBrowserModel()

  var body: some Scene {
    WindowGroup {
      RootWorkspaceView()
        .environmentObject(model)
        .task {
          model.startServices()
        }
        .frame(minWidth: 1280, minHeight: 820)
    }
  }
}
