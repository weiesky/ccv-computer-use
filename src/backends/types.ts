/**
 * Combined types for computer-use backends.
 *
 * Two sub-interfaces:
 *   - InputBackend: low-level keyboard/mouse synthesis
 *   - SwiftBackend: display/apps/screenshot (named after the original macOS Swift
 *     implementation; now cross-platform)
 */

export interface FrontmostAppInfo {
  bundleId: string // macOS: bundle ID, Windows: exe path
  appName: string
}

export interface InputBackend {
  moveMouse(x: number, y: number, animated: boolean): Promise<void>
  key(key: string, action: 'press' | 'release'): Promise<void>
  keys(parts: string[]): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  mouseButton(
    button: 'left' | 'right' | 'middle',
    action: 'click' | 'press' | 'release',
    count?: number,
  ): Promise<void>
  mouseScroll(
    amount: number,
    direction: 'vertical' | 'horizontal',
  ): Promise<void>
  typeText(text: string): Promise<void>
  getFrontmostAppInfo(): FrontmostAppInfo | null
}

// ---------------------------------------------------------------------------
// Swift backend (display / apps / screenshot)
// ---------------------------------------------------------------------------

export interface DisplayGeometry {
  width: number
  height: number
  scaleFactor: number
  displayId: number
  label?: string
  isPrimary?: boolean
}

export interface PrepareDisplayResult {
  activated: string
  hidden: string[]
}

export interface AppInfo {
  bundleId: string
  displayName: string
}

export interface InstalledApp {
  bundleId: string
  displayName: string
  path: string
  iconDataUrl?: string
}

export interface RunningApp {
  bundleId: string
  displayName: string
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
}

export interface ResolvePrepareCaptureResult {
  base64: string
  width: number
  height: number
  captureError?: string
  displayId?: number
  hidden?: string[]
}

export interface WindowDisplayInfo {
  bundleId: string
  displayIds: number[]
}

export interface DisplayAPI {
  getSize(displayId?: number): DisplayGeometry
  listAll(): DisplayGeometry[]
}

export interface AppsAPI {
  prepareDisplay(
    allowlistBundleIds: string[],
    surrogateHost: string,
    displayId?: number,
  ): Promise<PrepareDisplayResult>
  previewHideSet(bundleIds: string[], displayId?: number): Promise<AppInfo[]>
  findWindowDisplays(bundleIds: string[]): Promise<WindowDisplayInfo[]>
  appUnderPoint(x: number, y: number): Promise<AppInfo | null>
  listInstalled(): Promise<InstalledApp[]>
  iconDataUrl(path: string): string | null
  listRunning(): RunningApp[]
  open(bundleId: string): Promise<void>
  unhide(bundleIds: string[]): Promise<void>
}

export interface ScreenshotAPI {
  captureExcluding(
    allowedBundleIds: string[],
    quality: number,
    targetW: number,
    targetH: number,
    displayId?: number,
  ): Promise<ResolvePrepareCaptureResult>
  captureRegion(
    allowedBundleIds: string[],
    x: number,
    y: number,
    w: number,
    h: number,
    outW: number,
    outH: number,
    quality: number,
    displayId?: number,
  ): Promise<ScreenshotResult>
  captureWindowTarget?(titleOrHwnd: string | number): ScreenshotResult | null
}

export interface SwiftBackend {
  display: DisplayAPI
  apps: AppsAPI
  screenshot: ScreenshotAPI
}

export interface PlatformBackend {
  input: InputBackend
  swift: SwiftBackend
}
