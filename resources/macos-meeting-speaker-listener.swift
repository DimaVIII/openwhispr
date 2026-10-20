/**
 * macOS Meeting Speaker Listener
 *
 * Snapshots the accessibility tree of a running meeting app (Zoom first) so
 * OpenWhispr can tell which participant the app shows as speaking. The helper
 * is app-agnostic on purpose: it reports text-bearing elements and their
 * frames, and src/helpers/meetingAppSpeakerAdapters.js decides what a video
 * tile or an active-speaker marker looks like. Meeting apps restyle their UI
 * without notice; those fixes belong in JS beside their tests, not here.
 *
 * Usage:
 *   macos-meeting-speaker-listener --bundle-id us.zoom.xos [--bundle-id …] [--interval-ms 500]
 *   macos-meeting-speaker-listener --dump --bundle-id us.zoom.xos
 *
 * stdout, one JSON object per line:
 *   {"type":"start","intervalMs":500}
 *   {"type":"status","state":"waiting_for_app"}
 *   {"type":"status","state":"tracking","bundleId":"us.zoom.xos"}
 *   {"type":"status","state":"unreadable","bundleId":"us.zoom.xos","axError":-25204}
 *   {"type":"snapshot","at":<ms>,"bundleId":"us.zoom.xos","windows":[
 *     {"title":"Zoom Meeting","frame":[x,y,w,h],"nodes":[
 *       {"role":"AXGroup","description":"Jane Doe","frame":[x,y,w,h],"depth":7}]}]}
 *   {"type":"error","code":"accessibility_denied","message":"…"}  (then exits 2)
 *
 * A snapshot is written only when the reported tree changed, and carries an
 * element's title, description and help text but never its value (chat text
 * lives there). Uses the Accessibility permission the app already holds for
 * paste; no Screen Recording.
 *
 * --dump prints one full tree, values included, for calibrating the adapters
 * against a real meeting, then exits. It is a developer tool: its output can
 * contain participant names and chat messages.
 *
 * Compile: swiftc -O macos-meeting-speaker-listener.swift -o macos-meeting-speaker-listener
 */

import AppKit
import ApplicationServices
import Foundation

let defaultIntervalMs = 500
let minimumIntervalMs = 200
// Bounds on one snapshot, so a huge tree (a long chat, a 49-tile gallery) can't
// stall the poll or flood the pipe. Breadth-first, so video tiles near the top
// of the window are reached before deep list contents.
let maxVisitedNodes = 1_500
let maxDumpNodes = 5_000
let maxReportedNodes = 400
let maxDepth = 40
let maxTextLength = 200
// Meeting apps answer accessibility requests on their main thread; a busy
// meeting must delay one poll, not hang the helper.
let messagingTimeoutSeconds: Float = 0.25

// Attribute names as literals: their values are fixed by the AX API, and the
// list is passed to AXUIElementCopyMultipleAttributeValues as one CFArray.
let roleAttribute = "AXRole"
let subroleAttribute = "AXSubrole"
let titleAttribute = "AXTitle"
let descriptionAttribute = "AXDescription"
let helpAttribute = "AXHelp"
let positionAttribute = "AXPosition"
let sizeAttribute = "AXSize"
let childrenAttribute = "AXChildren"
let selectedAttribute = "AXSelected"
let valueAttribute = "AXValue"
let identifierAttribute = "AXIdentifier"

let nodeAttributes: [String] = [
    roleAttribute, subroleAttribute, titleAttribute, descriptionAttribute, helpAttribute,
    positionAttribute, sizeAttribute, childrenAttribute, selectedAttribute,
]
let dumpAttributes: [String] = nodeAttributes + [valueAttribute, identifierAttribute]

var bundleIds: [String] = []
var intervalMs = defaultIntervalMs
var dumpMode = false

let arguments = CommandLine.arguments
var argumentIndex = 1
while argumentIndex < arguments.count {
    let argument = arguments[argumentIndex]
    let next: String? = argumentIndex + 1 < arguments.count ? arguments[argumentIndex + 1] : nil
    if argument == "--bundle-id", let bundleId = next {
        bundleIds.append(bundleId)
        argumentIndex += 1
    } else if argument == "--interval-ms", let value = next.flatMap({ Int($0) }) {
        intervalMs = max(minimumIntervalMs, value)
        argumentIndex += 1
    } else if argument == "--dump" {
        dumpMode = true
    }
    argumentIndex += 1
}

func emit(_ payload: [String: Any], pretty: Bool = false) {
    let options: JSONSerialization.WritingOptions = pretty ? [.prettyPrinted, .sortedKeys] : []
    guard
        JSONSerialization.isValidJSONObject(payload),
        let data = try? JSONSerialization.data(withJSONObject: payload, options: options),
        let json = String(data: data, encoding: .utf8)
    else { return }
    print(json)
    fflush(stdout)
}

func emitError(code: String, message: String) {
    emit(["type": "error", "code": code, "message": message])
}

func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
}

// AX reports failures per attribute as AXValues of the error type.
func axValue(_ raw: AnyObject?) -> AnyObject? {
    guard let raw = raw else { return nil }
    if CFGetTypeID(raw) == AXValueGetTypeID(), AXValueGetType(raw as! AXValue) == .axError {
        return nil
    }
    return raw
}

func text(_ raw: AnyObject?) -> String? {
    guard let value = axValue(raw) as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : String(trimmed.prefix(maxTextLength))
}

func coordinate(_ value: CGFloat) -> Int? {
    guard value.isFinite, abs(value) < 1_000_000 else { return nil }
    return Int(value.rounded())
}

func frame(position rawPosition: AnyObject?, size rawSize: AnyObject?) -> [Int]? {
    guard
        let positionValue = axValue(rawPosition), CFGetTypeID(positionValue) == AXValueGetTypeID(),
        let sizeValue = axValue(rawSize), CFGetTypeID(sizeValue) == AXValueGetTypeID()
    else { return nil }

    var point = CGPoint.zero
    var size = CGSize.zero
    guard
        AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size),
        let x = coordinate(point.x), let y = coordinate(point.y),
        let width = coordinate(size.width), let height = coordinate(size.height)
    else { return nil }
    return [x, y, width, height]
}

// One round trip per element instead of one per attribute.
func attributes(of element: AXUIElement, _ names: [String]) -> [String: AnyObject] {
    var valuesRef: CFArray?
    let result = AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &valuesRef)
    guard result == .success, let values = valuesRef as? [AnyObject], values.count == names.count
    else { return [:] }

    var byName: [String: AnyObject] = [:]
    for (index, name) in names.enumerated() {
        if let value = axValue(values[index]) {
            byName[name] = value
        }
    }
    return byName
}

func describeNode(_ values: [String: AnyObject], depth: Int, includeValue: Bool) -> [String: Any] {
    var node: [String: Any] = ["depth": depth]
    if let role = text(values[roleAttribute]) { node["role"] = role }
    if let subrole = text(values[subroleAttribute]) { node["subrole"] = subrole }
    if let title = text(values[titleAttribute]) { node["title"] = title }
    if let description = text(values[descriptionAttribute]) { node["description"] = description }
    if let help = text(values[helpAttribute]) { node["help"] = help }
    if let nodeFrame = frame(position: values[positionAttribute], size: values[sizeAttribute]) {
        node["frame"] = nodeFrame
    }
    if (values[selectedAttribute] as? Bool) == true { node["selected"] = true }
    if includeValue {
        if let value = text(values[valueAttribute]) { node["value"] = value }
        if let identifier = text(values[identifierAttribute]) { node["identifier"] = identifier }
    }
    return node
}

func isTextBearing(_ node: [String: Any]) -> Bool {
    node["title"] != nil || node["description"] != nil || node["help"] != nil
}

func describeWindow(_ window: AXUIElement, dump: Bool) -> [String: Any] {
    let windowValues = attributes(of: window, dump ? dumpAttributes : nodeAttributes)
    var described: [String: Any] = [:]
    if let title = text(windowValues[titleAttribute]) { described["title"] = title }
    if let windowFrame = frame(position: windowValues[positionAttribute], size: windowValues[sizeAttribute]) {
        described["frame"] = windowFrame
    }

    var queue: [(element: AXUIElement, depth: Int)] =
        ((windowValues[childrenAttribute] as? [AXUIElement]) ?? []).map { (element: $0, depth: 1) }
    var head = 0
    var nodes: [[String: Any]] = []
    let visitLimit = dump ? maxDumpNodes : maxVisitedNodes

    while head < queue.count && head < visitLimit {
        let (element, depth) = queue[head]
        head += 1

        let values = attributes(of: element, dump ? dumpAttributes : nodeAttributes)
        let node = describeNode(values, depth: depth, includeValue: dump)
        if dump || (isTextBearing(node) && nodes.count < maxReportedNodes) {
            nodes.append(node)
        }

        if depth < maxDepth, let children = values[childrenAttribute] as? [AXUIElement] {
            for child in children {
                queue.append((element: child, depth: depth + 1))
            }
        }
    }

    described["nodes"] = nodes
    if head < queue.count { described["truncated"] = true }
    return described
}

func runningTarget() -> (app: NSRunningApplication, bundleId: String)? {
    for bundleId in bundleIds {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        if let app = running.first(where: { !$0.isTerminated }) {
            return (app: app, bundleId: bundleId)
        }
    }
    return nil
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> (value: AnyObject?, error: AXError) {
    var valueRef: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, name as CFString, &valueRef)
    return (value: result == .success ? axValue(valueRef) : nil, error: result)
}

func asElement(_ value: AnyObject?) -> AXUIElement? {
    guard let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

// Zoom 7.2 sometimes answers AXWindows with an empty list while its meeting
// window is open and readable through AXChildren and AXMainWindow, so those
// fill in. error is set only when no window could be read and AXWindows
// itself failed, so a refused read never passes for "no meeting".
func windowElements(of appElement: AXUIElement) -> (windows: [AXUIElement], error: AXError?) {
    let listed = elementAttribute(appElement, "AXWindows")
    var windows = (listed.value as? [AXUIElement]) ?? []
    if windows.isEmpty {
        var candidates = ((elementAttribute(appElement, childrenAttribute).value as? [AXUIElement]) ?? [])
            .filter { text(elementAttribute($0, roleAttribute).value) == "AXWindow" }
        for name in ["AXMainWindow", "AXFocusedWindow"] {
            if let window = asElement(elementAttribute(appElement, name).value) {
                candidates.append(window)
            }
        }
        for candidate in candidates where !windows.contains(where: { CFEqual($0, candidate) }) {
            windows.append(candidate)
        }
    }
    return (windows: windows, error: windows.isEmpty && listed.error != .success ? listed.error : nil)
}

func describeApp(_ app: NSRunningApplication, dump: Bool) -> (windows: [[String: Any]], error: AXError?) {
    let found = windowElements(of: AXUIElementCreateApplication(app.processIdentifier))
    return (windows: found.windows.map { describeWindow($0, dump: dump) }, error: found.error)
}

if bundleIds.isEmpty {
    emitError(code: "usage", message: "Usage: macos-meeting-speaker-listener [--dump] --bundle-id <id> [--interval-ms <ms>]")
    exit(64)
}

// The app's own Accessibility grant covers this helper, as it does the text
// monitor; without it every read fails, so stop rather than poll for nothing.
if !AXIsProcessTrusted() {
    emitError(code: "accessibility_denied", message: "Accessibility permission is required to read the meeting app")
    exit(2)
}

_ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), messagingTimeoutSeconds)

if dumpMode {
    guard let target = runningTarget() else {
        emitError(code: "app_not_running", message: "None of the requested apps is running")
        exit(1)
    }
    let described = describeApp(target.app, dump: true)
    if let error = described.error {
        emitError(code: "windows_unreadable", message: "Could not read the app's windows (AXError \(error.rawValue))")
        exit(1)
    }
    emit(
        ["type": "dump", "at": nowMs(), "bundleId": target.bundleId, "windows": described.windows],
        pretty: true
    )
    exit(0)
}

var signalSources: [DispatchSourceSignal] = []
for signalNumber in [SIGTERM, SIGINT] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { exit(0) }
    source.resume()
    signalSources.append(source)
}

var lastStatus = ""
var lastWindowsJSON: Data?

func reportStatus(_ state: String, bundleId: String? = nil, axError: AXError? = nil) {
    let key = state + ":" + (bundleId ?? "") + ":" + (axError.map { String($0.rawValue) } ?? "")
    guard key != lastStatus else { return }
    lastStatus = key
    var payload: [String: Any] = ["type": "status", "state": state]
    if let bundleId = bundleId { payload["bundleId"] = bundleId }
    if let axError = axError { payload["axError"] = Int(axError.rawValue) }
    emit(payload)
}

func poll() {
    // Orphaned by a crashed app (reparented to launchd): nothing reads stdout
    // any more, and the helper writes too rarely for SIGPIPE to end it.
    if getppid() == 1 { exit(0) }

    guard let target = runningTarget() else {
        lastWindowsJSON = nil
        reportStatus("waiting_for_app")
        return
    }
    let described = describeApp(target.app, dump: false)
    if let error = described.error {
        lastWindowsJSON = nil
        reportStatus("unreadable", bundleId: target.bundleId, axError: error)
        return
    }
    reportStatus("tracking", bundleId: target.bundleId)

    let windows = described.windows
    guard
        JSONSerialization.isValidJSONObject(windows),
        let windowsJSON = try? JSONSerialization.data(withJSONObject: windows, options: [.sortedKeys])
    else { return }
    if windowsJSON == lastWindowsJSON { return }
    lastWindowsJSON = windowsJSON

    emit(["type": "snapshot", "at": nowMs(), "bundleId": target.bundleId, "windows": windows])
}

emit(["type": "start", "intervalMs": intervalMs])

let pollTimer = DispatchSource.makeTimerSource(queue: .main)
pollTimer.schedule(deadline: .now(), repeating: .milliseconds(intervalMs))
pollTimer.setEventHandler { poll() }
pollTimer.resume()

CFRunLoopRun()
