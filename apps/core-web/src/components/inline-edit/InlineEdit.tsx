import * as React from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

type InlineEditMode = 'text' | 'textarea'

type InlineEditProps = {
  value?: string | null
  onSave: (nextValue: string) => Promise<void> | void
  mode?: InlineEditMode
  placeholder?: string
  emptyText?: string
  rows?: number
  readOnly?: boolean
  className?: string
  displayClassName?: string
  inputClassName?: string
  ariaLabel?: string
}

function getFocusableElements() {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1,
  )
}

function findNextFocusable(current: HTMLElement, reverse: boolean) {
  const focusableElements = getFocusableElements()
  const index = focusableElements.indexOf(current)
  if (index < 0) return null
  const nextIndex = reverse ? index - 1 : index + 1
  return focusableElements[nextIndex] ?? null
}

export function InlineEdit({
  value,
  onSave,
  mode = 'text',
  placeholder = '',
  emptyText = 'Click to edit',
  rows = 4,
  readOnly = false,
  className,
  displayClassName,
  inputClassName,
  ariaLabel,
}: InlineEditProps) {
  const normalizedValue = value ?? ''
  const [isEditing, setIsEditing] = React.useState(false)
  const [draftValue, setDraftValue] = React.useState(normalizedValue)
  const [isSaving, setIsSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const skipBlurCommitRef = React.useRef(false)

  React.useEffect(() => {
    if (!isEditing) {
      setDraftValue(normalizedValue)
    }
  }, [isEditing, normalizedValue])

  React.useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => {
      const node = mode === 'textarea' ? textareaRef.current : inputRef.current
      if (!node) return
      node.focus()
      const length = node.value.length
      node.setSelectionRange(length, length)
    })
  }, [isEditing, mode])

  const closeEditor = React.useCallback(() => {
    skipBlurCommitRef.current = true
    setIsEditing(false)
  }, [])

  const cancelEdit = React.useCallback(() => {
    setDraftValue(normalizedValue)
    closeEditor()
  }, [closeEditor, normalizedValue])

  const commitEdit = React.useCallback(async () => {
    if (draftValue === normalizedValue) {
      closeEditor()
      return true
    }

    try {
      setIsSaving(true)
      await onSave(draftValue)
      closeEditor()
      return true
    } finally {
      setIsSaving(false)
    }
  }, [closeEditor, draftValue, normalizedValue, onSave])

  const handleBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      return
    }
    void commitEdit().catch(() => undefined)
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
      return
    }

    if (mode === 'text') {
      if (event.key === 'Enter') {
        event.preventDefault()
        void commitEdit().catch(() => undefined)
        return
      }

      if (event.key === 'Tab') {
        const nextFocusable = findNextFocusable(
          event.currentTarget as HTMLElement,
          event.shiftKey,
        )
        event.preventDefault()
        void commitEdit().then(() => {
          if (nextFocusable) {
            nextFocusable.focus()
          }
        }).catch(() => undefined)
      }
      return
    }

    if (
      mode === 'textarea' &&
      event.key === 'Enter' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      void commitEdit().catch(() => undefined)
    }
  }

  const beginEdit = () => {
    if (readOnly) return
    setDraftValue(normalizedValue)
    skipBlurCommitRef.current = false
    setIsEditing(true)
  }

  if (isEditing) {
    if (mode === 'textarea') {
      return (
        <textarea
          ref={textareaRef}
          rows={rows}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring',
            inputClassName,
          )}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={isSaving}
        />
      )
    }

    return (
      <Input
        ref={inputRef}
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn('h-9 text-sm', inputClassName)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={isSaving}
      />
    )
  }

  const hasValue = normalizedValue.trim().length > 0
  const displayValue = hasValue ? normalizedValue : emptyText

  const displayContent = (
    <div
      className={cn(
        'group/inline-edit relative w-full rounded-md px-2 py-1 -mx-2 text-left transition-colors',
        !readOnly && 'hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span
        className={cn(
          'block pr-5 text-sm',
          mode === 'textarea' && 'whitespace-pre-wrap',
          !hasValue && 'text-muted-foreground italic',
          displayClassName,
        )}
      >
        {displayValue}
      </span>
      {!readOnly && (
        <Pencil className='pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-70' />
      )}
    </div>
  )

  if (readOnly) {
    return displayContent
  }

  return (
    <button type='button' onClick={beginEdit} className='w-full text-left'>
      {displayContent}
    </button>
  )
}
