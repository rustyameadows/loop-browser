import Foundation
import Network

final class LocalMCPServer {
  private weak var model: LoopBrowserModel?
  private let queue = DispatchQueue(label: "dev.loopbrowser.native.mcp", qos: .userInitiated)
  private var listener: NWListener?
  private var token: String = ""
  private var started = false

  var onConnectionInfo: ((MCPConnectionInfo) -> Void)?
  var onError: ((String) -> Void)?

  init(model: LoopBrowserModel) {
    self.model = model
  }

  func startIfNeeded() {
    guard !started else { return }
    started = true

    do {
      token = try loadOrCreateToken()
      let parameters = NWParameters.tcp
      parameters.allowLocalEndpointReuse = true
      let listener = try NWListener(using: parameters, on: .any)
      self.listener = listener
      listener.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          guard let port = listener.port?.rawValue else { return }
          let info = MCPConnectionInfo(
            url: "http://127.0.0.1:\(port)/mcp",
            token: self.token,
            registrationFile: self.registrationFileURL().path
          )
          do {
            try self.writeRegistrationManifest(info: info)
            self.onConnectionInfo?(info)
          } catch {
            self.onError?("Could not write MCP registration manifest: \(error.localizedDescription)")
          }
        case .failed(let error):
          self.onError?("MCP server failed: \(error.localizedDescription)")
        default:
          break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        self?.handle(connection: connection)
      }
      listener.start(queue: queue)
    } catch {
      onError?("Could not start MCP server: \(error.localizedDescription)")
    }
  }

  private func handle(connection: NWConnection) {
    connection.start(queue: queue)
    receive(on: connection, buffer: Data())
  }

  private func receive(on connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1_048_576) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      var nextBuffer = buffer
      if let data {
        nextBuffer.append(data)
      }

      if let request = self.parseRequest(from: nextBuffer) {
        Task {
          let response = await self.process(request: request)
          connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
          })
        }
        return
      }

      if isComplete || error != nil {
        connection.cancel()
        return
      }

      self.receive(on: connection, buffer: nextBuffer)
    }
  }

  private func parseRequest(from data: Data) -> HTTPRequest? {
    guard let text = String(data: data, encoding: .utf8) else { return nil }
    guard let headerRange = text.range(of: "\r\n\r\n") else { return nil }

    let headerPart = String(text[..<headerRange.lowerBound])
    let bodyPart = String(text[headerRange.upperBound...])
    let headerLines = headerPart.components(separatedBy: "\r\n")
    guard let requestLine = headerLines.first else { return nil }
    let requestLineParts = requestLine.components(separatedBy: " ")
    guard requestLineParts.count >= 2 else { return nil }

    var headers: [String: String] = [:]
    for line in headerLines.dropFirst() {
      let components = line.split(separator: ":", maxSplits: 1).map(String.init)
      guard components.count == 2 else { continue }
      headers[components[0].lowercased()] = components[1].trimmingCharacters(in: .whitespaces)
    }

    let contentLength = Int(headers["content-length"] ?? "") ?? 0
    guard bodyPart.utf8.count >= contentLength else { return nil }

    let bodyData = Data(bodyPart.utf8.prefix(contentLength))
    return HTTPRequest(
      method: requestLineParts[0],
      path: requestLineParts[1],
      headers: headers,
      body: bodyData
    )
  }

  private func process(request: HTTPRequest) async -> Data {
    if request.path == "/health", request.method == "GET" {
      return jsonHTTPResponse(statusCode: 200, body: [
        "status": "ok",
        "projectOpen": await MainActor.run { model?.projectRoot != nil },
      ])
    }

    guard request.path == "/mcp" else {
      return jsonHTTPResponse(statusCode: 404, body: [
        "error": "Not found",
      ])
    }

    guard isAuthorized(request.headers["authorization"]) else {
      return jsonHTTPResponse(statusCode: 401, body: [
        "error": "Unauthorized",
      ])
    }

    guard isAllowedOrigin(request.headers["origin"]) else {
      return jsonHTTPResponse(statusCode: 403, body: [
        "error": "Forbidden origin",
      ])
    }

    let json: [String: Any]
    do {
      let object = try JSONSerialization.jsonObject(with: request.body, options: [])
      json = object as? [String: Any] ?? [:]
    } catch {
      return jsonRPCError(id: nil, code: -32700, message: "Invalid JSON")
    }

    let requestID = json["id"]
    let method = json["method"] as? String ?? ""
    let params = json["params"] as? [String: Any] ?? [:]

    do {
      let result = try await dispatch(method: method, params: params)
      return jsonHTTPResponse(statusCode: 200, body: [
        "jsonrpc": "2.0",
        "id": requestID as Any,
        "result": result,
      ])
    } catch {
      return jsonRPCError(id: requestID, code: -32000, message: error.localizedDescription)
    }
  }

  private func dispatch(method: String, params: [String: Any]) async throws -> Any {
    switch method {
    case "initialize":
      return [
        "protocolVersion": params["protocolVersion"] as? String ?? "2025-03-26",
        "serverInfo": [
          "name": "loop-browser-native",
          "version": "0.1.0",
        ],
        "capabilities": [
          "resources": [:],
          "tools": [
            "listChanged": false,
          ],
        ],
      ]
    case "tools/list":
      return [
        "tools": toolDefinitions(),
      ]
    case "resources/list":
      return [
        "resources": try await resourcesList(),
      ]
    case "resources/templates/list":
      return [
        "resourceTemplates": [
          [
            "uriTemplate": "loop-browser:///session/{sessionId}/summary",
            "name": "session-summary",
            "title": "Session Summary",
            "description": "Summary for a Loop Browser Native workspace session.",
            "mimeType": "application/json",
          ],
          [
            "uriTemplate": "loop-browser:///session/{sessionId}/workspace",
            "name": "session-workspace",
            "title": "Workspace State",
            "description": "Workspace state for a Loop Browser Native session.",
            "mimeType": "application/json",
          ],
        ],
      ]
    case "resources/read":
      guard let uri = params["uri"] as? String else {
        throw MCPError.message("resources/read requires a uri.")
      }
      return try await resourceRead(uri: uri)
    case "tools/call":
      guard let name = params["name"] as? String else {
        throw MCPError.message("Tool calls require a name.")
      }
      let arguments = params["arguments"] as? [String: Any] ?? [:]
      return try await toolCall(name: name, arguments: arguments)
    default:
      throw MCPError.message("Unknown JSON-RPC method: \(method)")
    }
  }

  private func toolDefinitions() -> [[String: Any]] {
    [
      [
        "name": "session.list",
        "description": "List the current Loop Browser Native session if a project is open.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "session.getCurrent",
        "description": "Return the current focused session.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "workspace.get_state",
        "description": "Return project, canvas, and viewport state for the active workspace.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "browser.listTabs",
        "description": "List live viewports as browser tabs.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "browser.getWindowState",
        "description": "Return the current window size and canvas transform.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "page.navigate",
        "description": "Navigate a viewport to a new route or URL.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
            "target": ["type": "string"],
          ],
          required: ["target"]
        ),
      ],
      [
        "name": "page.reload",
        "description": "Reload one viewport or all current viewports.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
          ],
          required: []
        ),
      ],
      [
        "name": "chrome.getAppearance",
        "description": "Return the current project appearance settings.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "chrome.setAppearance",
        "description": "Update project appearance and startup settings.",
        "inputSchema": schema(
          properties: [
            "chromeColor": ["type": "string"],
            "accentColor": ["type": "string"],
            "projectIconPath": ["type": "string"],
            "defaultUrl": ["type": "string"],
          ],
          required: []
        ),
      ],
      [
        "name": "create_viewport",
        "description": "Create a single live viewport on the canvas.",
        "inputSchema": schema(
          properties: [
            "route": ["type": "string"],
            "url": ["type": "string"],
            "label": ["type": "string"],
            "width": ["type": "number"],
            "height": ["type": "number"],
          ],
          required: []
        ),
      ],
      [
        "name": "create_viewports",
        "description": "Create multiple live viewports on the canvas.",
        "inputSchema": [
          "type": "object",
          "properties": [
            "viewports": [
              "type": "array",
              "items": [
                "type": "object",
              ],
            ],
          ],
          "required": ["viewports"],
          "additionalProperties": false,
        ],
      ],
      [
        "name": "update_viewport_route",
        "description": "Update a viewport route or URL.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
            "route": ["type": "string"],
            "url": ["type": "string"],
          ],
          required: ["viewportId"]
        ),
      ],
      [
        "name": "update_viewport_size",
        "description": "Resize a viewport.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
            "width": ["type": "number"],
            "height": ["type": "number"],
          ],
          required: ["viewportId", "width", "height"]
        ),
      ],
      [
        "name": "close_viewport",
        "description": "Close a viewport.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
          ],
          required: ["viewportId"]
        ),
      ],
      [
        "name": "refresh_viewport",
        "description": "Refresh a single viewport.",
        "inputSchema": schema(
          properties: [
            "viewportId": ["type": "string"],
          ],
          required: ["viewportId"]
        ),
      ],
      [
        "name": "refresh_all_viewports",
        "description": "Refresh all current viewports.",
        "inputSchema": schema(properties: [:], required: []),
      ],
      [
        "name": "edit_project_files",
        "description": "Write or delete project files inside the active project root and refresh viewports.",
        "inputSchema": [
          "type": "object",
          "properties": [
            "writes": [
              "type": "array",
              "items": [
                "type": "object",
                "properties": [
                  "path": ["type": "string"],
                  "contents": ["type": "string"],
                ],
                "required": ["path", "contents"],
              ],
            ],
            "deletes": [
              "type": "array",
              "items": ["type": "string"],
            ],
          ],
          "required": [],
          "additionalProperties": false,
        ],
      ],
    ]
  }

  private func resourcesList() async throws -> [[String: Any]] {
    let sessions = await MainActor.run { model?.currentSessionSummary }
    guard let session = sessions else {
      return [[
        "uri": "loop-browser:///sessions",
        "name": "sessions",
        "title": "Sessions",
        "description": "Open Loop Browser Native sessions.",
        "mimeType": "application/json",
      ]]
    }

    return [
      [
        "uri": "loop-browser:///sessions",
        "name": "sessions",
        "title": "Sessions",
        "description": "Open Loop Browser Native sessions.",
        "mimeType": "application/json",
      ],
      [
        "uri": "loop-browser:///session/\(session.sessionId)/summary",
        "name": "session-summary",
        "title": "Session Summary",
        "description": "Summary for the current session.",
        "mimeType": "application/json",
      ],
      [
        "uri": "loop-browser:///session/\(session.sessionId)/workspace",
        "name": "session-workspace",
        "title": "Workspace State",
        "description": "Workspace state for the current session.",
        "mimeType": "application/json",
      ],
    ]
  }

  private func resourceRead(uri: String) async throws -> [String: Any] {
    if uri == "loop-browser:///sessions" {
      let session = await MainActor.run { model?.currentSessionSummary }
      return buildJSONResource(uri: uri, payload: [
        "sessions": session.map { [$0] } ?? [],
      ])
    }

    let session = await MainActor.run { model?.currentSessionSummary }
    guard let session else {
      throw MCPError.message("No active project session.")
    }

    if uri == "loop-browser:///session/\(session.sessionId)/summary" {
      return buildJSONResource(uri: uri, payload: [
        "session": session.asDictionary(),
      ])
    }

    if uri == "loop-browser:///session/\(session.sessionId)/workspace" {
      let workspace = await MainActor.run { model?.workspaceSummary() ?? [:] }
      return buildJSONResource(uri: uri, payload: workspace)
    }

    throw MCPError.message("Resource not found: \(uri)")
  }

  private func toolCall(name: String, arguments: [String: Any]) async throws -> [String: Any] {
    switch name {
    case "session.list":
      let session = await MainActor.run { model?.currentSessionSummary }
      return toolResult([
        "sessions": session.map { [$0.asDictionary()] } ?? [],
      ])
    case "session.getCurrent":
      let session = await MainActor.run { model?.currentSessionSummary }
      return toolResult([
        "session": session?.asDictionary() as Any,
      ])
    case "workspace.get_state":
      let state = await MainActor.run { model?.workspaceSummary() ?? [:] }
      return toolResult(state)
    case "browser.listTabs":
      let tabs = await MainActor.run {
        model?.viewports.map { viewport in
          [
            "tabId": viewport.id.uuidString,
            "url": viewport.currentURLString,
            "title": viewport.pageTitle,
            "isLoading": viewport.status == .loading || viewport.status == .refreshing,
          ] as [String: Any]
        } ?? []
      }
      return toolResult(["tabs": tabs])
    case "browser.getWindowState":
      let window = await MainActor.run {
        let viewportCount = model?.viewports.count ?? 0
        return [
          "window": [
            "scale": model?.canvasScale ?? 1,
            "offsetX": model?.canvasOffset.width ?? 0,
            "offsetY": model?.canvasOffset.height ?? 0,
            "viewportCount": viewportCount,
          ],
        ] as [String: Any]
      }
      return toolResult(window)
    case "page.navigate":
      guard let target = arguments["target"] as? String else {
        throw MCPError.message("page.navigate requires a target.")
      }
      await MainActor.run {
        if let viewportID = arguments["viewportId"] as? String,
           let uuid = UUID(uuidString: viewportID) {
          model?.updateViewportRoute(viewportID: uuid, routeOrURL: target)
        } else if let active = model?.activeViewport() {
          model?.updateViewportRoute(viewportID: active.id, routeOrURL: target)
        } else {
          _ = model?.addViewport(routeOrURL: target)
        }
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "page.reload":
      await MainActor.run {
        if let viewportID = arguments["viewportId"] as? String,
           let uuid = UUID(uuidString: viewportID) {
          model?.refreshViewport(viewportID: uuid)
        } else {
          model?.refreshAllViewports()
        }
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "chrome.getAppearance":
      return toolResult(await MainActor.run { model?.chromeAppearanceState() ?? [:] })
    case "chrome.setAppearance":
      await MainActor.run {
        model?.saveProjectAppearance(
          defaultUrl: arguments["defaultUrl"] as? String ?? (model?.configuredDefaultURL ?? ""),
          chromeColor: arguments["chromeColor"] as? String ?? (model?.projectConfig.chrome.chromeColor ?? "#FAFBFD"),
          accentColor: arguments["accentColor"] as? String ?? (model?.projectConfig.chrome.accentColor ?? "#0A84FF"),
          projectIconPath: arguments["projectIconPath"] as? String ?? (model?.projectConfig.chrome.projectIconPath ?? "")
        )
      }
      return toolResult(await MainActor.run { model?.chromeAppearanceState() ?? [:] })
    case "create_viewport":
      let target = (arguments["url"] as? String) ?? (arguments["route"] as? String) ?? ""
      let label = arguments["label"] as? String
      let width = arguments["width"] as? Double ?? 1200
      let height = arguments["height"] as? Double ?? 800
      let created = await MainActor.run {
        model?.addViewport(routeOrURL: target, label: label, width: width, height: height)?.snapshot()
      }
      return toolResult([
        "viewport": created.map { $0.asDictionary() } as Any,
      ])
    case "create_viewports":
      let definitions = arguments["viewports"] as? [[String: Any]] ?? []
      await MainActor.run {
        model?.addViewports(definitions: definitions)
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "update_viewport_route":
      guard let viewportID = arguments["viewportId"] as? String, let uuid = UUID(uuidString: viewportID) else {
        throw MCPError.message("update_viewport_route requires viewportId.")
      }
      let target = (arguments["url"] as? String) ?? (arguments["route"] as? String) ?? ""
      await MainActor.run {
        model?.updateViewportRoute(viewportID: uuid, routeOrURL: target)
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "update_viewport_size":
      guard let viewportID = arguments["viewportId"] as? String, let uuid = UUID(uuidString: viewportID) else {
        throw MCPError.message("update_viewport_size requires viewportId.")
      }
      let width = arguments["width"] as? Double ?? 1200
      let height = arguments["height"] as? Double ?? 800
      await MainActor.run {
        model?.updateViewportSize(viewportID: uuid, width: width, height: height)
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "close_viewport":
      guard let viewportID = arguments["viewportId"] as? String, let uuid = UUID(uuidString: viewportID) else {
        throw MCPError.message("close_viewport requires viewportId.")
      }
      await MainActor.run {
        model?.closeViewport(viewportID: uuid)
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "refresh_viewport":
      guard let viewportID = arguments["viewportId"] as? String, let uuid = UUID(uuidString: viewportID) else {
        throw MCPError.message("refresh_viewport requires viewportId.")
      }
      await MainActor.run {
        model?.refreshViewport(viewportID: uuid)
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "refresh_all_viewports":
      await MainActor.run {
        model?.refreshAllViewports()
      }
      return toolResult(await MainActor.run { model?.workspaceSummary() ?? [:] })
    case "edit_project_files":
      let writes = arguments["writes"] as? [[String: Any]] ?? []
      let deletes = arguments["deletes"] as? [String] ?? []
      let result = await MainActor.run {
        model?.editProjectFiles(writes: writes, deletes: deletes) ?? [:]
      }
      return toolResult(result)
    default:
      throw MCPError.message("Unknown tool: \(name)")
    }
  }

  private func buildJSONResource(uri: String, payload: [String: Any]) -> [String: Any] {
    [
      "contents": [
        [
          "uri": uri,
          "mimeType": "application/json",
          "text": stringifiedJSON(payload),
        ],
      ],
    ]
  }

  private func toolResult(_ value: [String: Any]) -> [String: Any] {
    [
      "content": [
        [
          "type": "text",
          "text": stringifiedJSON(value),
        ],
      ],
      "structuredContent": value,
    ]
  }

  private func schema(properties: [String: Any], required: [String]) -> [String: Any] {
    [
      "type": "object",
      "properties": properties,
      "required": required,
      "additionalProperties": false,
    ]
  }

  private func stringifiedJSON(_ value: Any) -> String {
    guard
      JSONSerialization.isValidJSONObject(value),
      let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
      let text = String(data: data, encoding: .utf8)
    else {
      return "{}"
    }
    return text
  }

  private func isAuthorized(_ authorization: String?) -> Bool {
    authorization == "Bearer \(token)"
  }

  private func isAllowedOrigin(_ origin: String?) -> Bool {
    guard let origin, !origin.isEmpty, origin != "null" else {
      return true
    }
    return origin.contains("127.0.0.1") || origin.contains("localhost")
  }

  private func registrationFileURL() -> URL {
    applicationSupportDirectory().appendingPathComponent("mcp-registration.json")
  }

  private func tokenFileURL() -> URL {
    applicationSupportDirectory().appendingPathComponent("mcp-token")
  }

  private func loadOrCreateToken() throws -> String {
    let fileURL = tokenFileURL()
    try FileManager.default.createDirectory(at: applicationSupportDirectory(), withIntermediateDirectories: true)
    if let existing = try? String(contentsOf: fileURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       !existing.isEmpty {
      return existing
    }
    let token = Data((0..<24).map { _ in UInt8.random(in: .min ... .max) }).map { String(format: "%02x", $0) }.joined()
    try token.write(to: fileURL, atomically: true, encoding: .utf8)
    return token
  }

  private func writeRegistrationManifest(info: MCPConnectionInfo) throws {
    try FileManager.default.createDirectory(at: applicationSupportDirectory(), withIntermediateDirectories: true)
    let payload: [String: Any] = [
      "server": [
        "name": "loop-browser-native",
        "version": "0.1.0",
      ],
      "transport": [
        "type": "streamable_http",
        "url": info.url,
        "headers": [
          "Authorization": "Bearer \(info.token)",
        ],
      ],
      "tools": toolDefinitions().map { $0["name"] as? String ?? "" },
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: registrationFileURL(), options: .atomic)
  }

  private func jsonHTTPResponse(statusCode: Int, body: [String: Any]) -> Data {
    let payload = (try? JSONSerialization.data(withJSONObject: body, options: [])) ?? Data()
    let header = """
    HTTP/1.1 \(statusCode) \(httpStatusText(statusCode))
    Content-Type: application/json; charset=utf-8
    Content-Length: \(payload.count)
    Connection: close

    """
    return Data(header.utf8) + payload
  }

  private func jsonRPCError(id: Any?, code: Int, message: String) -> Data {
    jsonHTTPResponse(statusCode: 200, body: [
      "jsonrpc": "2.0",
      "id": id as Any,
      "error": [
        "code": code,
        "message": message,
      ],
    ])
  }

  private func httpStatusText(_ code: Int) -> String {
    switch code {
    case 200: return "OK"
    case 401: return "Unauthorized"
    case 403: return "Forbidden"
    case 404: return "Not Found"
    default: return "Error"
    }
  }
}

private struct HTTPRequest {
  var method: String
  var path: String
  var headers: [String: String]
  var body: Data
}

private enum MCPError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let value):
      return value
    }
  }
}

private extension SessionSummary {
  func asDictionary() -> [String: Any] {
    [
      "sessionId": sessionId,
      "projectRoot": projectRoot,
      "projectName": projectName,
      "defaultUrl": defaultUrl,
      "viewportCount": viewportCount,
    ]
  }
}

private extension ViewportSnapshot {
  func asDictionary() -> [String: Any] {
    [
      "id": id.uuidString,
      "label": label,
      "url": urlString,
      "status": status.rawValue,
      "lastRefreshedAt": lastRefreshedAt?.ISO8601Format() as Any,
      "frame": [
        "x": frame.x,
        "y": frame.y,
        "width": frame.width,
        "height": frame.height,
      ],
    ]
  }
}
