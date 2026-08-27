export function terminalLivePreview(
  scrollback: string,
  fallbackLines: readonly string[] = [],
  maxLines = 12,
) {
  const normalized = scrollback.replace(/\r/g, '').trim()
  if (!normalized) {
    return fallbackLines.join('\n')
  }

  let lineStart = normalized.length
  let linesSeen = 0
  while (lineStart > 0 && linesSeen < maxLines) {
    lineStart = normalized.lastIndexOf('\n', lineStart - 1)
    linesSeen += 1
    if (lineStart < 0) {
      return normalized
    }
  }

  return normalized.slice(lineStart + 1)
}

export function terminalLineCount(scrollback: string, fallbackLineCount = 0) {
  const normalized = scrollback.replace(/\r/g, '')
  if (!normalized) {
    return fallbackLineCount
  }

  let count = 1
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) === 10) {
      count += 1
    }
  }
  return count
}
