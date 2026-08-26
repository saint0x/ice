import { describe, expect, it } from 'vitest'
import { tabMetaString, tabMetaUtilityTool } from '@/lib/tabMeta'
import type { Tab } from '@/types'

const tab: Tab = {
  id: 'tab-1',
  projectId: 'project-1',
  type: 'settings',
  title: 'Settings',
  meta: {
    path: '/tmp/file.ts',
    empty: '',
    numeric: 42,
    tool: 'search',
  },
}

describe('tab metadata helpers', () => {
  it('returns only non-empty string metadata', () => {
    expect(tabMetaString(tab, 'path')).toBe('/tmp/file.ts')
    expect(tabMetaString(tab, 'empty')).toBeNull()
    expect(tabMetaString(tab, 'numeric')).toBeNull()
    expect(tabMetaString({ ...tab, meta: undefined }, 'path')).toBeNull()
  })

  it('accepts known settings tools and falls back for invalid restored values', () => {
    expect(tabMetaUtilityTool(tab)).toBe('search')
    expect(tabMetaUtilityTool({ ...tab, meta: { tool: 'banana' } })).toBe('diagnostics')
    expect(tabMetaUtilityTool({ ...tab, meta: { tool: 42 } })).toBe('diagnostics')
    expect(tabMetaUtilityTool({ ...tab, meta: undefined }, 'files')).toBe('files')
  })
})
