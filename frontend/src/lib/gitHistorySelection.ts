type GitHistorySelectionEntry = { commit: string }

export function nextSelectedHistoryCommit(
  currentCommit: string | null,
  entries: GitHistorySelectionEntry[],
) {
  if (currentCommit && entries.some((entry) => entry.commit === currentCommit)) {
    return currentCommit
  }
  return entries[0]?.commit ?? null
}
