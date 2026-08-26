import type { Tab } from '@/types'

export type UtilityTool = 'files' | 'search' | 'diagnostics' | 'debug'

const UTILITY_TOOLS = new Set<UtilityTool>(['files', 'search', 'diagnostics', 'debug'])

export function tabMetaString(tab: Tab, key: string): string | null {
  const value = tab.meta?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function tabMetaUtilityTool(tab: Tab, fallback: UtilityTool = 'diagnostics'): UtilityTool {
  const value = tab.meta?.tool
  return typeof value === 'string' && UTILITY_TOOLS.has(value as UtilityTool)
    ? value as UtilityTool
    : fallback
}
