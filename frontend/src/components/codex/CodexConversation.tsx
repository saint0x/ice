import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Bot, Check, Ban, Loader2, ShieldAlert } from 'lucide-react'
import type { CodexApproval, CodexMessage, CodexThread, ProjectId } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './CodexConversation.module.css'

interface Props {
  approvals: CodexApproval[]
  approvalBusyId: string | null
  fallbackMessage?: string
  messages: CodexMessage[]
  onApproval: (approvalId: string, mode: 'approve' | 'deny') => void
  projectId?: ProjectId
  projectPath?: string
  surfaceError?: string | null
  threadStatus?: CodexThread['status']
}

interface MessageBlock {
  type: 'text' | 'code' | 'tool' | 'json' | 'diff'
  content: string
  language?: string
}

export const CodexConversation = memo(function CodexConversation({
  approvals,
  approvalBusyId,
  fallbackMessage,
  messages,
  onApproval,
  projectId,
  projectPath,
  surfaceError,
  threadStatus,
}: Props) {
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const endRef = useRef<HTMLDivElement | null>(null)
  const messageSignature = useMemo(() => {
    const last = messages[messages.length - 1]
    return last ? `${last.id}:${last.updatedAt}:${last.state}:${last.content.length}` : 'empty'
  }, [messages])
  const hasStreamingAssistantMessage = useMemo(
    () => messages.some((message) => message.role === 'assistant' && message.state === 'streaming'),
    [messages],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [approvalBusyId, approvals.length, messageSignature, threadStatus])

  return (
    <div className={styles.messages}>
      {surfaceError ? (
        <div className={styles.errorBanner}>
          <ShieldAlert size={13} />
          <span>{surfaceError}</span>
        </div>
      ) : null}

      {messages.length > 0 ? messages.map((message) => (
        message.role === 'user' ? (
          <div key={message.id} className={styles.userRow}>
            <div className={styles.userBubble}>
              <MessageBody content={message.content} projectId={projectId} projectPath={projectPath} openFile={openTab} activePaneId={activePaneId} />
              <div className={styles.messageMeta}>{formatTimestamp(message.updatedAt)}</div>
            </div>
          </div>
        ) : (
          <div key={message.id} className={styles.agentRow}>
            <div className={styles.agentAvatar}>
              <Bot size={14} />
            </div>
            <div className={styles.agentContent}>
              <div className={styles.agentBubble}>
                <MessageBody
                  content={message.content}
                  streaming={message.state === 'streaming'}
                  projectId={projectId}
                  projectPath={projectPath}
                  openFile={openTab}
                  activePaneId={activePaneId}
                />
              </div>
              <div className={styles.messageMetaRow}>
                <span className={styles.messageMeta}>{formatTimestamp(message.updatedAt)}</span>
                {message.state === 'streaming' ? <span className={styles.streamingLabel}>Streaming live...</span> : null}
              </div>
            </div>
          </div>
        )
      )) : null}

      {messages.length === 0 && fallbackMessage ? (
        <div className={styles.agentRow}>
          <div className={styles.agentAvatar}>
            <Bot size={14} />
          </div>
          <div className={styles.agentContent}>
            <div className={styles.agentBubble}>
              <MessageBody content={fallbackMessage} projectId={projectId} projectPath={projectPath} openFile={openTab} activePaneId={activePaneId} />
            </div>
          </div>
        </div>
      ) : null}

      {approvals.map((approval) => (
        <div key={approval.id} className={styles.agentRow}>
          <div className={`${styles.agentAvatar} ${styles.approvalAvatar}`}>
            <ShieldAlert size={14} />
          </div>
          <div className={styles.agentContent}>
            <div className={styles.approvalCard}>
              <div className={styles.approvalTitleRow}>
                <span className={styles.approvalTitle}>Approval required</span>
                <span className={styles.approvalAction}>{approval.actionType}</span>
              </div>
              <div className={styles.agentBubble}>
                <MessageBody content={approval.description} projectId={projectId} projectPath={projectPath} openFile={openTab} activePaneId={activePaneId} />
              </div>
              <div className={styles.approvalMeta}>
                {approval.category ? <span className={styles.metaPill}>{approval.category}</span> : null}
                {approval.riskLevel ? <span className={styles.metaPill}>{approval.riskLevel}</span> : null}
                {approval.policyAction ? <span className={styles.metaPill}>{approval.policyAction}</span> : null}
              </div>
              {approval.policyReason ? (
                <div className={styles.policyReason}>{approval.policyReason}</div>
              ) : null}
              {approval.context !== undefined ? (
                <details className={styles.contextDetails}>
                  <summary className={styles.contextSummary}>Request details</summary>
                  <pre className={styles.contextBlock}>{formatContext(approval.context)}</pre>
                </details>
              ) : null}
            </div>
            <div className={styles.artifacts}>
              <button
                className={styles.artifact}
                onClick={() => onApproval(approval.id, 'approve')}
                disabled={approvalBusyId === approval.id}
              >
                <Check size={12} />
                <span>{approvalBusyId === approval.id ? 'Working...' : 'Approve'}</span>
              </button>
              <button
                className={styles.artifact}
                onClick={() => onApproval(approval.id, 'deny')}
                disabled={approvalBusyId === approval.id}
              >
                <Ban size={12} />
                <span>Deny</span>
              </button>
            </div>
          </div>
        </div>
      ))}

      {threadStatus === 'running' && !hasStreamingAssistantMessage ? (
        <div className={styles.agentRow}>
          <div className={styles.agentAvatar}>
            <Loader2 size={14} className={styles.spinner} />
          </div>
          <div className={styles.thinkingLabel}>Thinking...</div>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  )
})

const MessageBody = memo(function MessageBody({
  content,
  streaming = false,
  projectId,
  projectPath,
  openFile,
  activePaneId,
}: {
  content: string
  streaming?: boolean
  projectId?: ProjectId
  projectPath?: string
  openFile: ReturnType<typeof useWorkspaceStore.getState>['openTab']
  activePaneId: string
}) {
  const blocks = useMemo(
    () => (streaming ? [] : parseMessageBlocks(content)),
    [content, streaming],
  )
  const openReferencedFile = (rawPath: string) => {
    if (!projectId) return
    const reference = normalizeFileReference(rawPath, projectPath)
    if (!reference.openPath) return
    openFile(
      activePaneId,
      'editor',
      reference.label.split('/').pop() ?? reference.label,
      projectId,
      { path: reference.openPath },
    )
  }

  if (streaming) {
    return (
      <div className={styles.messageBody}>
        <div className={styles.streamingText}>{content}</div>
      </div>
    )
  }

  return (
    <div className={styles.messageBody}>
      {blocks.map((block, index) => {
        if (block.type === 'code' || block.type === 'tool' || block.type === 'json' || block.type === 'diff') {
          return (
            <div
              key={`code-${index}`}
              className={`${styles.codeBlock} ${block.type === 'tool' ? styles.toolBlock : ''} ${block.type === 'json' ? styles.jsonBlock : ''} ${block.type === 'diff' ? styles.diffBlock : ''}`}
            >
              <div className={styles.codeLanguage}>
                {block.type === 'tool'
                  ? `Tool Result${block.language ? ` · ${block.language}` : ''}`
                  : block.type === 'json'
                    ? 'Structured Output'
                    : block.type === 'diff'
                      ? 'Diff Output'
                      : block.language ?? 'code'}
              </div>
              <pre className={styles.codeContent}>{block.content}</pre>
            </div>
          )
        }

        return (
          <div key={`text-${index}`} className={styles.textBlock}>
            {block.content.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
              <p key={`paragraph-${paragraphIndex}`} className={styles.paragraph}>
                {renderParagraphWithFileRefs(paragraph, projectPath, openReferencedFile)}
              </p>
            ))}
          </div>
        )
      })}
    </div>
  )
})

function parseMessageBlocks(content: string): MessageBlock[] {
  const normalized = content.trim()
  if (!normalized) {
    return [{ type: 'text', content: '' }]
  }

  const blocks: MessageBlock[] = []
  const codeFence = /```([\w.-]+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = codeFence.exec(normalized)) !== null) {
    const [fullMatch, language, code] = match
    const codeContent = code ?? ''
    const leadingText = normalized.slice(lastIndex, match.index).trim()
    if (leadingText) {
      blocks.push({ type: 'text', content: leadingText })
    }
    blocks.push({
      type: classifyCodeBlock(language?.trim() || undefined),
      content: codeContent.replace(/\n$/, ''),
      language: language?.trim() || undefined,
    })
    lastIndex = match.index + fullMatch.length
  }

  const trailingText = normalized.slice(lastIndex).trim()
  if (trailingText) {
    blocks.push({ type: 'text', content: trailingText })
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: normalized }]
}

function classifyCodeBlock(language?: string): MessageBlock['type'] {
  const normalized = language?.toLowerCase()
  if (!normalized) return 'code'
  if (['bash', 'sh', 'zsh', 'shell', 'console'].includes(normalized)) return 'tool'
  if (normalized === 'json') return 'json'
  if (['diff', 'patch'].includes(normalized)) return 'diff'
  return 'code'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatContext(context: unknown): string {
  if (typeof context === 'string') {
    return context
  }
  try {
    return JSON.stringify(context, null, 2)
  } catch {
    return String(context)
  }
}

const MARKDOWN_FILE_LINK_PATTERN = /\[`([^`\n]+)`\]\((file:\/\/\/[^)\s]+)\)/g
const FILE_URL_PATTERN = /file:\/\/\/[^\s)]+/g
const FILE_REFERENCE_PATTERN = /(?:\/[A-Za-z0-9._~\- /]+?\.[A-Za-z0-9]+|(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]+|[A-Za-z0-9._-]+\.[A-Za-z0-9]+)(?::\d+)?/g

interface FileReferenceMatch {
  start: number
  end: number
  rawPath: string
  displayLabel?: string
}

function renderParagraphWithFileRefs(
  paragraph: string,
  projectPath: string | undefined,
  onOpenFile: (rawPath: string) => void,
) {
  const matches = collectFileReferenceMatches(paragraph)
  if (matches.length === 0) return paragraph

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of matches) {
    const { rawPath, start, end, displayLabel } = match
    if (start > cursor) {
      nodes.push(paragraph.slice(cursor, start))
    }
    const reference = normalizeFileReference(rawPath, projectPath, displayLabel)
    nodes.push(
      <button
        key={`${rawPath}:${start}`}
        type="button"
        className={styles.artifactChip}
        onClick={() => onOpenFile(rawPath)}
        disabled={!reference.openPath}
      >
        <span>{reference.label}</span>
        <span className={styles.artifactAction}>{reference.openPath ? 'Open' : 'Ref'}</span>
      </button>,
    )
    cursor = end
  }
  if (cursor < paragraph.length) {
    nodes.push(paragraph.slice(cursor))
  }
  return nodes
}

function collectFileReferenceMatches(paragraph: string): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = []

  for (const match of paragraph.matchAll(MARKDOWN_FILE_LINK_PATTERN)) {
    const [fullMatch = '', label = '', fileUrl = ''] = match
    const start = match.index ?? 0
    matches.push({
      start,
      end: start + fullMatch.length,
      rawPath: decodeFileUrl(fileUrl),
      displayLabel: label.trim(),
    })
  }

  for (const match of paragraph.matchAll(FILE_URL_PATTERN)) {
    const [fileUrl] = match
    const start = match.index ?? 0
    const end = start + fileUrl.length
    if (matches.some((existing) => rangesOverlap(existing.start, existing.end, start, end))) {
      continue
    }
    matches.push({
      start,
      end,
      rawPath: decodeFileUrl(fileUrl),
    })
  }

  for (const match of paragraph.matchAll(FILE_REFERENCE_PATTERN)) {
    const [rawPath] = match
    const start = match.index ?? 0
    const end = start + rawPath.length
    if (matches.some((existing) => rangesOverlap(existing.start, existing.end, start, end))) {
      continue
    }
    matches.push({ start, end, rawPath })
  }

  return matches.sort((left, right) => left.start - right.start)
}

function decodeFileUrl(fileUrl: string): string {
  const withoutScheme = fileUrl.replace(/^file:\/\//, '')
  try {
    return decodeURIComponent(withoutScheme)
  } catch {
    return withoutScheme
  }
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA
}

function normalizeFileReference(rawPath: string, projectPath?: string, displayLabel?: string) {
  const [pathPart = rawPath] = rawPath.split(':')
  const trimmedPath = pathPart.trim()
  const normalizedProjectPath = projectPath?.replace(/\/+$/, '')
  if (normalizedProjectPath && trimmedPath.startsWith(`${normalizedProjectPath}/`)) {
    const relativePath = trimmedPath.slice(normalizedProjectPath.length + 1)
    return {
      label: displayLabel || relativePath,
      openPath: relativePath,
    }
  }
  if (!trimmedPath.startsWith('/')) {
    return {
      label: displayLabel || trimmedPath,
      openPath: trimmedPath,
    }
  }
  return {
    label: displayLabel || (trimmedPath.split('/').pop() ?? trimmedPath),
    openPath: null,
  }
}
