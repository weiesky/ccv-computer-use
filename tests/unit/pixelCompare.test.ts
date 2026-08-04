import { describe, expect, test } from 'vitest'
import sharp from 'sharp'

import type { ScreenshotResult } from '../../src/executor.js'
import { createStandaloneAdapter } from '../../src/host/adapter.js'
import type { ComputerExecutor } from '../../src/executor.js'
import {
  comparePixelAtLocation,
  validateClickTarget,
} from '../../src/pixelCompare.js'
import type { Logger } from '../../src/types.js'

// ---------- fixtures ----------

/** Build a solid-color JPEG, return base64 + dimensions. */
async function makeSolidJpeg(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
): Promise<ScreenshotResult> {
  const jpeg = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: rgb,
    },
  })
    .jpeg()
    .toBuffer()
  return {
    base64: jpeg.toString('base64'),
    width,
    height,
    // The pixel-compare path only reads base64/width/height, but the type
    // requires the rest of the ScreenshotResult surface.
    displayWidth: width,
    displayHeight: height,
    originX: 0,
    originY: 0,
    displayId: 1,
  }
}

/** No-op logger so validateClickTarget doesn't write to stderr in tests. */
function makeNoopLogger(): Logger {
  return {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    silly: () => {},
  }
}

/**
 * Build the standalone adapter's `cropRawPatch` without spinning up the
 * whole adapter (which needs a real ComputerExecutor). We only need the
 * sharp-backed crop function, so we use a minimal fake executor.
 */
async function makeCropFn() {
  const fakeExecutor: ComputerExecutor = {
    getDisplaySize: async () => ({ width: 100, height: 100 }),
    screenshot: async () => {
      throw new Error('not used in tests')
    },
    // The remaining ComputerExecutor surface is unused by cropRawPatch.
    // Cast via unknown to satisfy the interface without filling it out.
  } as unknown as ComputerExecutor
  const adapter = createStandaloneAdapter({ executor: fakeExecutor })
  return adapter.cropRawPatch
}

// ---------- comparePixelAtLocation ----------

describe('comparePixelAtLocation', () => {
  test('returns true when both screenshots are identical solid color', async () => {
    const crop = await makeCropFn()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const red2 = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })

    const match = await comparePixelAtLocation(crop, red, red2, 50, 50)
    expect(match).toBe(true)
  })

  test('returns false when screenshots differ at the target location', async () => {
    const crop = await makeCropFn()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const blue = await makeSolidJpeg(100, 100, { r: 0, g: 0, b: 255 })

    const match = await comparePixelAtLocation(crop, red, blue, 50, 50)
    expect(match).toBe(false)
  })

  test('returns false when crop fails (invalid base64)', async () => {
    const crop = await makeCropFn()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const garbage: ScreenshotResult = {
      base64: '!!! not base64 jpeg !!!',
      width: 100,
      height: 100,
      displayWidth: 100,
      displayHeight: 100,
      originX: 0,
      originY: 0,
      displayId: 1,
    }

    const match = await comparePixelAtLocation(crop, red, garbage, 50, 50)
    expect(match).toBe(false)
  })

  test('handles edge-of-screen coordinates (clamped to image bounds)', async () => {
    const crop = await makeCropFn()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const red2 = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })

    // (100%, 100%) is the bottom-right corner — the crop rect clamps into
    // the image and should still compare equal.
    const match = await comparePixelAtLocation(crop, red, red2, 100, 100)
    expect(match).toBe(true)
  })
})

// ---------- validateClickTarget ----------

describe('validateClickTarget', () => {
  test('skips (valid:true) when no lastScreenshot (cold start)', async () => {
    const crop = await makeCropFn()
    const logger = makeNoopLogger()

    const result = await validateClickTarget(crop, undefined, 50, 50, async () => {
      throw new Error('fresh screenshot must not be taken on cold start')
    }, logger)

    expect(result).toEqual({ valid: true, skipped: true })
  })

  test('valid:true (not skipped) when screenshots match', async () => {
    const crop = await makeCropFn()
    const logger = makeNoopLogger()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const red2 = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })

    const result = await validateClickTarget(
      crop,
      red,
      50,
      50,
      async () => red2,
      logger,
    )

    expect(result).toEqual({ valid: true, skipped: false })
  })

  test('valid:false with warning when fresh screenshot differs (stale detection)', async () => {
    const crop = await makeCropFn()
    const logger = makeNoopLogger()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const blue = await makeSolidJpeg(100, 100, { r: 0, g: 0, b: 255 })

    const result = await validateClickTarget(
      crop,
      red,
      50,
      50,
      async () => blue,
      logger,
    )

    expect(result.valid).toBe(false)
    expect(result.skipped).toBe(false)
    expect(result.warning).toMatch(/changed since the last screenshot/i)
  })

  test('skips when fresh screenshot capture returns null', async () => {
    const crop = await makeCropFn()
    const logger = makeNoopLogger()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })

    const result = await validateClickTarget(
      crop,
      red,
      50,
      50,
      async () => null,
      logger,
    )

    expect(result).toEqual({ valid: true, skipped: true })
  })

  test('skips when fresh screenshot capture throws', async () => {
    const crop = await makeCropFn()
    const logger = makeNoopLogger()
    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })

    const result = await validateClickTarget(
      crop,
      red,
      50,
      50,
      async () => {
        throw new Error('simulated capture failure')
      },
      logger,
    )

    expect(result).toEqual({ valid: true, skipped: true })
  })
})

// ---------- standalone adapter integration ----------

describe('createStandaloneAdapter (pixel validation wiring)', () => {
  test('getSubGates().pixelValidation is true', async () => {
    const fakeExecutor = {
      getDisplaySize: async () => ({ width: 100, height: 100 }),
    } as unknown as ComputerExecutor
    const adapter = createStandaloneAdapter({ executor: fakeExecutor })

    expect(adapter.getSubGates().pixelValidation).toBe(true)
  })

  test('cropRawPatch returns a non-empty buffer for a valid JPEG', async () => {
    const fakeExecutor = {
      getDisplaySize: async () => ({ width: 100, height: 100 }),
    } as unknown as ComputerExecutor
    const adapter = createStandaloneAdapter({ executor: fakeExecutor })

    const red = await makeSolidJpeg(100, 100, { r: 255, g: 0, b: 0 })
    const patch = await adapter.cropRawPatch(red.base64, {
      x: 45,
      y: 45,
      width: 9,
      height: 9,
    })

    expect(patch).not.toBeNull()
    // sharp .raw() yields RGB (3 channels × 9 × 9 = 243 bytes) by default
    expect(patch!.length).toBe(9 * 9 * 3)
  })

  test('cropRawPatch returns null on bad base64 input (never throws)', async () => {
    const fakeExecutor = {
      getDisplaySize: async () => ({ width: 100, height: 100 }),
    } as unknown as ComputerExecutor
    const adapter = createStandaloneAdapter({ executor: fakeExecutor })

    const patch = await adapter.cropRawPatch('!!! not a jpeg !!!', {
      x: 0,
      y: 0,
      width: 9,
      height: 9,
    })

    expect(patch).toBeNull()
  })
})
