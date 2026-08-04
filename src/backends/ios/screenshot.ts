/**
 * iOS Simulator screenshot capture via `xcrun simctl io`.
 *
 * We write to a temporary PNG/JPEG file, read it back as base64, and probe
 * the dimensions from the file header (no native deps). JPEG is preferred
 * for size (~150KB vs ~1MB PNG), but PNG is used as a fallback if the
 * simulator rejects `--type=jpeg`.
 */

import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { runSync } from '../_shared/spawn.js'

export interface IOSScreenshotResult {
  base64: string
  width: number
  height: number
  /** 'jpeg' or 'png' — reflects the actual format captured. */
  format: 'jpeg' | 'png'
}

/** Probe PNG dimensions from the IHDR chunk (bytes 16-24). */
function pngDims(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Probe JPEG dimensions by scanning SOF0/SOF2 markers. */
function jpegDims(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4) return null
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buf[offset + 1]
    // SOF0 (baseline) / SOF2 (progressive) — both have the same dims layout.
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buf.readUInt16BE(offset + 5)
      const width = buf.readUInt16BE(offset + 7)
      return { width, height }
    }
    const len = buf.readUInt16BE(offset + 2)
    if (len < 2) return null
    offset += 2 + len
  }
  return null
}

function captureOne(udid: string, format: 'jpeg' | 'png'): IOSScreenshotResult {
  const path = join(
    tmpdir(),
    `ccv-computer-use-ios-${randomUUID()}.${format === 'jpeg' ? 'jpg' : 'png'}`,
  )
  try {
    runSync([
      'xcrun',
      'simctl',
      'io',
      udid,
      'screenshot',
      `--type=${format}`,
      path,
    ])
    const buf = readFileSync(path)
    const dims = format === 'jpeg' ? jpegDims(buf) : pngDims(buf)
    if (!dims) {
      throw new Error(
        `simctl wrote ${path} but dimensions could not be parsed (${format}).`,
      )
    }
    return {
      base64: buf.toString('base64'),
      width: dims.width,
      height: dims.height,
      format,
    }
  } finally {
    try {
      rmSync(path, { force: true })
    } catch {
      // Temp file leak is acceptable — macOS purges /tmp periodically.
    }
  }
}

/**
 * Capture the simulator's screen. Prefers JPEG (smaller) and falls back to
 * PNG if the device rejects the format flag (older Xcode). Throws on failure.
 */
export async function captureIOSScreenshot(
  udid: string,
): Promise<IOSScreenshotResult> {
  try {
    return captureOne(udid, 'jpeg')
  } catch {
    return captureOne(udid, 'png')
  }
}
