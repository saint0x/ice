import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { dirCreate, entryDelete, entryRename } from '@/lib/backend'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('backend invoke contracts', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('calls the registered directory create command', async () => {
    await dirCreate({ projectId: 'project-1', path: 'src/generated' })

    expect(invoke).toHaveBeenCalledWith('dir_create', {
      input: { projectId: 'project-1', path: 'src/generated' },
    })
  })

  it('calls the registered entry delete command with recursive intent', async () => {
    await entryDelete({ projectId: 'project-1', path: 'src/old', recursive: true })

    expect(invoke).toHaveBeenCalledWith('entry_delete', {
      input: { projectId: 'project-1', path: 'src/old', recursive: true },
    })
  })

  it('calls the registered entry rename command without overwrite flags', async () => {
    await entryRename({ projectId: 'project-1', from: 'src/old.ts', to: 'src/new.ts' })

    expect(invoke).toHaveBeenCalledWith('entry_rename', {
      input: { projectId: 'project-1', from: 'src/old.ts', to: 'src/new.ts' },
    })
  })
})
