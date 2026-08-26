import { describe, expect, it } from 'vitest'
import { editMenuCommandForId } from '@/hooks/useMenuEvents'

describe('native menu edit command mapping', () => {
  it('maps edit menu ids to executable app commands', () => {
    expect(editMenuCommandForId('edit.undo')).toBe('undo')
    expect(editMenuCommandForId('edit.redo')).toBe('redo')
    expect(editMenuCommandForId('edit.cut')).toBe('cut')
    expect(editMenuCommandForId('edit.copy')).toBe('copy')
    expect(editMenuCommandForId('edit.paste')).toBe('paste')
    expect(editMenuCommandForId('edit.select_all')).toBe('selectAll')
  })

  it('rejects unknown menu ids instead of manufacturing commands', () => {
    expect(editMenuCommandForId('edit.selectall')).toBeNull()
    expect(editMenuCommandForId('edit.format_document')).toBeNull()
  })
})
