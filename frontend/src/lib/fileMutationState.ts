export interface DeleteIntent {
  confirmed: boolean
  armedPath: string | null
}

interface FileMutationWithRefreshInput {
  mutate: () => Promise<void>
  refresh: () => Promise<void>
  onMutationSuccess?: () => void
  onMutationError: (error: unknown) => void
  onRefreshError: (error: unknown) => void
}

export function resolveDeleteIntent(selectedPath: string | null, armedPath: string | null): DeleteIntent {
  if (!selectedPath) {
    return { confirmed: false, armedPath: null }
  }

  if (armedPath === selectedPath) {
    return { confirmed: true, armedPath: null }
  }

  return { confirmed: false, armedPath: selectedPath }
}

export async function runFileMutationWithRefresh(input: FileMutationWithRefreshInput) {
  try {
    await input.mutate()
  } catch (error) {
    input.onMutationError(error)
    return false
  }

  input.onMutationSuccess?.()

  try {
    await input.refresh()
  } catch (error) {
    input.onRefreshError(error)
  }

  return true
}
