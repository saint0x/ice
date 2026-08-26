import { describe, expect, it } from 'vitest'
import { findActiveTabId } from '@/hooks/useKeyboardShortcuts'
import type { PaneLayout } from '@/types'

describe('keyboard shortcut tab resolution', () => {
  it('returns the active tab from the active pane in split layouts', () => {
    const layout: PaneLayout = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        {
          id: 'pane-1',
          type: 'leaf',
          tabs: ['tab-a'],
          activeTabId: 'tab-a',
        },
        {
          id: 'pane-2',
          type: 'leaf',
          tabs: ['tab-b', 'tab-c'],
          activeTabId: 'tab-b',
        },
      ],
    }

    expect(findActiveTabId(layout, 'pane-2')).toBe('tab-b')
  })

  it('returns null when the active pane does not exist', () => {
    const layout: PaneLayout = {
      id: 'pane-1',
      type: 'leaf',
      tabs: ['tab-a'],
      activeTabId: 'tab-a',
    }

    expect(findActiveTabId(layout, 'pane-missing')).toBeNull()
  })
})
