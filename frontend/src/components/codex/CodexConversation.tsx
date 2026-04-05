import { memo, useEffect, useMemo, useRef } from 'react'
import { Bot, Check, Ban, Loader2, ShieldAlert } from 'lucide-react'
import type { CodexApproval, CodexMessage, CodexThread } from '@/types'
import styles from './CodexConversation.module.css'

interface Props {
  approvals: CodexApproval[]
  approvalBusyId: string | null
  fallbackMessage: string
  messages: CodexMessage[]
  onApproval: (approvalId: string, mode: 'approve' | 'deny') => void
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
  surfaceError,
  threadStatus,
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const messageSignature = useMemo(() => {
    const last = messages[messages.length - 1]
    return last ? `${last.id}:${last.updatedAt}:${last.state}:${last.content.length}` : 'empty'
  }, [messages])

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
              <MessageBody content={message.content} />
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
                <MessageBody content={message.content} />
              </div>
              <div className={styles.messageMetaRow}>
                <span className={styles.messageMeta}>{formatTimestamp(message.updatedAt)}</span>
                {message.state === 'streaming' ? <span className={styles.streamingLabel}>Streaming live...</span> : null}
              </div>
            </div>
          </div>
        )
      )) : (
        <div className={styles.agentRow}>
          <div className={styles.agentAvatar}>
            <Bot size={14} />
          </div>
          <div className={styles.agentContent}>
            <div className={styles.agentBubble}>
              <MessageBody content={fallbackMessage} />
            </div>
          </div>
        </div>
      )}

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
                <MessageBody content={approval.description} />
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

      {threadStatus === 'running' ? (
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

const MessageBody = memo(function MessageBody({ content }: { content: string }) {
  const blocks = useMemo(() => parseMessageBlocks(content), [content])
  const artifacts = useMemo(() => extractArtifacts(content), [content])

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
                {paragraph}
              </p>
            ))}
          </div>
        )
      })}
      {artifacts.length > 0 ? (
        <div className={styles.artifactList}>
          {artifacts.map((artifact) => (
            <button
              key={artifact}
              type="button"
              className={styles.artifactChip}
              onClick={() => void navigator.clipboard.writeText(artifact)}
            >
              <span>{artifact}</span>
              <span className={styles.artifactAction}>Copy</span>
            </button>
          ))}
        </div>
      ) : null}
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

function extractArtifacts(content: string) {
  const matches = content.match(/(?:\/[\w./-]+|[\w./-]+\.(?:rs|ts|tsx|js|jsx|json|md|css|toml|yml|yaml|sh))/g) ?? []
  return [...new Set(matches)].slice(0, 8)
}
