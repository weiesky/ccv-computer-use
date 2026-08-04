import { describe, expect, test } from 'vitest'

import {
  API_RESIZE_PARAMS,
  targetImageSize,
} from '../../src/imageResize.js'

describe('imageResize', () => {
  test('preserves small images', () => {
    const [width, height] = targetImageSize(800, 600, API_RESIZE_PARAMS)
    expect(width).toBe(800)
    expect(height).toBe(600)
  })

  test('downscales large images to fit 1568 long edge', () => {
    const [width, height] = targetImageSize(4096, 2048, API_RESIZE_PARAMS)
    expect(width).toBeLessThanOrEqual(1568)
    expect(height).toBeLessThanOrEqual(1568)
    expect(width / height).toBeCloseTo(2, 1)
  })

  test('respects token budget', () => {
    // 28 px/tile, 1568 tokens max → max ~1568x1568 pixels at typical density
    const [width, height] = targetImageSize(10000, 10000, API_RESIZE_PARAMS)
    expect(Math.max(width, height)).toBeLessThanOrEqual(1568)
  })
})
