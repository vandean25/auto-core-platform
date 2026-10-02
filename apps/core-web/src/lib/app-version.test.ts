import { describe, expect, it } from 'vitest'
import {
  hasNewAppVersion,
  isAppVersionCheckEnabled,
  normalizeAppVersion,
} from './app-version'

describe('app-version', () => {
  describe('normalizeAppVersion', () => {
    it('maps empty and whitespace to dev', () => {
      expect(normalizeAppVersion(undefined)).toBe('dev')
      expect(normalizeAppVersion(null)).toBe('dev')
      expect(normalizeAppVersion('')).toBe('dev')
      expect(normalizeAppVersion('   ')).toBe('dev')
    })

    it('preserves tagged release values', () => {
      expect(normalizeAppVersion('v1.2.3')).toBe('v1.2.3')
    })
  })

  describe('isAppVersionCheckEnabled', () => {
    it('is disabled for dev builds', () => {
      expect(isAppVersionCheckEnabled('dev')).toBe(false)
      expect(isAppVersionCheckEnabled('')).toBe(false)
    })

    it('is enabled when a release tag is embedded', () => {
      expect(isAppVersionCheckEnabled('v2026.04.01')).toBe(true)
    })
  })

  describe('hasNewAppVersion', () => {
    it('returns false when bundled version is dev', () => {
      expect(hasNewAppVersion('dev', 'v9.9.9')).toBe(false)
      expect(hasNewAppVersion('', 'v9.9.9')).toBe(false)
    })

    it('returns false when remote is dev or matches bundled', () => {
      expect(hasNewAppVersion('v1.0.0', 'dev')).toBe(false)
      expect(hasNewAppVersion('v1.0.0', 'v1.0.0')).toBe(false)
    })

    it('returns true when remote differs from bundled release', () => {
      expect(hasNewAppVersion('v1.0.0', 'v1.0.1')).toBe(true)
    })
  })
})
