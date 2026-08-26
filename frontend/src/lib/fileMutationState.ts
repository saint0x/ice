export interface DeleteIntent {
  confirmed: boolean
  armedPath: string | null
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
