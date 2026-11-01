import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil } from 'lucide-react'
import { mobileFieldTextClass } from '@/lib/mobile-field-text'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import type { ZodType } from 'zod'

type InlineEditMode = 'text' | 'textarea'

type InlineEditProps = {
  value?: string | null
  onSave: (nextValue: string) => Promise<void> | void
  /** Optional Zod schema to validate the draft value before committing. */
  schema?: ZodType<string>
  /** Character cap for the editor, matching the limit the API enforces on the field. */
  maxLength?: number
  mode?: InlineEditMode
  placeholder?: string
  emptyText?: string
  rows?: number
  readOnly?: boolean
  className?: string
  displayClassName?: string
  inputClassName?: string
  ariaLabel?: string
  /** When true, uses a tel keyboard and autocomplete for phone numbers. */
  phone?: boolean
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

interface KeyDownContext {
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  mode: InlineEditMode
  onCancel: () => void
  onCommit: () => Promise<boolean | void>
}

function handleInlineEditKeyDown({
  event,
  mode,
  onCancel,
  onCommit,
}: KeyDownContext) {
  if (event.key === 'Escape') {
    event.preventDefault()
    onCancel()
    return
  }

  if (mode === 'text') {
    if (event.key === 'Enter') {
      event.preventDefault()
      void onCommit().catch(() => undefined)
      return
    }

    if (event.key === 'Tab') {
      const nextFocusable = findNextFocusable(
        event.currentTarget as HTMLElement,
        event.shiftKey,
      )
      event.preventDefault()
      void onCommit()
        .then((committed) => {
          if (committed && nextFocusable) {
            nextFocusable.focus()
          }
        })
        .catch(() => undefined)
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
    void onCommit().catch(() => undefined)
  }
}

type InputRef = React.RefObject<HTMLInputElement | null>
type TextareaRef = React.RefObject<HTMLTextAreaElement | null>

function activeEditorNode(mode: InlineEditMode, inputRef: InputRef, textareaRef: TextareaRef) {
  return mode === 'textarea' ? textareaRef.current : inputRef.current
}

/** Moves focus to the editor node on the next frame. */
function focusActiveEditor(mode: InlineEditMode, inputRef: InputRef, textareaRef: TextareaRef) {
  requestAnimationFrame(() => {
    activeEditorNode(mode, inputRef, textareaRef)?.focus()
  })
}

type InlineEditSessionOptions = {
  mode: InlineEditMode
  readOnly: boolean
  value?: string | null
  emptyText?: string
  onSave: (nextValue: string) => Promise<void> | void
  schema?: ZodType<string>
}

/** Owns the draft value, focus, saving flag and validation error of an edit session. */
function useInlineEditSession({
  mode,
  readOnly,
  value,
  emptyText,
  onSave,
  schema,
}: InlineEditSessionOptions) {
  const { t } = useTranslation('common')
  const normalizedValue = value ?? ''
  const [isEditing, setIsEditing] = React.useState(false)
  const [draftValue, setDraftValue] = React.useState(normalizedValue)
  const [isSaving, setIsSaving] = React.useState(false)
  const [validationError, setValidationError] = React.useState<string | null>(null)
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
      const node = activeEditorNode(mode, inputRef, textareaRef)
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
    setValidationError(null)
    closeEditor()
  }, [closeEditor, normalizedValue])

  const rejectDraft = React.useCallback(
    (message: string) => {
      setValidationError(message)
      focusActiveEditor(mode, inputRef, textareaRef)
    },
    [inputRef, mode, textareaRef],
  )

  const commitEdit = React.useCallback(async () => {
    if (draftValue === normalizedValue) {
      setValidationError(null)
      closeEditor()
      return true
    }

    const result = schema?.safeParse(draftValue)
    if (result && !result.success) {
      rejectDraft(result.error.issues[0]?.message ?? t('inlineEdit.invalidValue'))
      return false
    }

    setValidationError(null)

    try {
      setIsSaving(true)
      await onSave(draftValue)
      closeEditor()
      return true
    } finally {
      setIsSaving(false)
    }
  }, [closeEditor, draftValue, normalizedValue, onSave, rejectDraft, schema, t])

  const handleBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      return
    }
    void commitEdit().catch(() => undefined)
  }

  const beginEdit = () => {
    if (readOnly) return
    setDraftValue(normalizedValue)
    skipBlurCommitRef.current = false
    setIsEditing(true)
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    handleInlineEditKeyDown({
      event,
      mode,
      onCancel: cancelEdit,
      onCommit: commitEdit,
    })
  }

  return {
    beginEdit,
    draftValue,
    handleBlur,
    handleKeyDown,
    inputRef,
    isEditing,
    isSaving,
    normalizedValue,
    resolvedEmptyText: emptyText ?? t('inlineEdit.emptyText'),
    setDraftValue,
    textareaRef,
    validationError,
  }
}

interface InlineEditorBaseProps {
  draftValue: string
  onChange: (val: string) => void
  onBlur: () => void
  validationError: string | null
  isSaving: boolean
  placeholder?: string
  ariaLabel?: string
  inputClassName?: string
  maxLength?: number
}

function InlineEditError({ errorId, message }: { errorId: string; message: string }) {
  return <p id={errorId} className='mt-1 text-xs text-red-500' role='alert'>{message}</p>
}

type InlineTextInputProps = InlineEditorBaseProps & {
  inputRef: React.RefObject<HTMLInputElement | null>
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  phone?: boolean
}

function InlineTextInput({
  inputRef,
  onKeyDown,
  phone,
  draftValue,
  onChange,
  onBlur,
  validationError,
  isSaving,
  placeholder,
  ariaLabel,
  inputClassName,
  maxLength,
}: InlineTextInputProps) {
  const errorId = React.useId()

  return (
    <div>
      <Input
        ref={inputRef}
        type={phone ? 'tel' : undefined}
        autoComplete={phone ? 'tel' : undefined}
        value={draftValue}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'h-9',
          validationError && 'border-red-500 focus-visible:ring-red-500',
          inputClassName,
        )}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={!!validationError}
        aria-describedby={validationError ? errorId : undefined}
        disabled={isSaving}
      />
      {validationError && <InlineEditError errorId={errorId} message={validationError} />}
    </div>
  )
}

type InlineTextareaInputProps = InlineEditorBaseProps & {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  rows: number
}

function InlineTextareaInput({
  textareaRef,
  onKeyDown,
  rows,
  draftValue,
  onChange,
  onBlur,
  validationError,
  isSaving,
  placeholder,
  ariaLabel,
  inputClassName,
  maxLength,
}: InlineTextareaInputProps) {
  const errorId = React.useId()

  return (
    <div>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={draftValue}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full rounded-md border border-input bg-background px-3 py-2 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring',
          mobileFieldTextClass,
          validationError && 'border-red-500 focus-visible:ring-red-500',
          inputClassName,
        )}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={!!validationError}
        aria-describedby={validationError ? errorId : undefined}
        disabled={isSaving}
      />
      {validationError && <InlineEditError errorId={errorId} message={validationError} />}
    </div>
  )
}

interface InlineEditDisplayProps {
  normalizedValue: string
  emptyText: string
  mode: InlineEditMode
  readOnly: boolean
  isSaving: boolean
  className?: string
  displayClassName?: string
  onBeginEdit: () => void
}

function InlineEditDisplay({
  normalizedValue,
  emptyText,
  mode,
  readOnly,
  isSaving,
  className,
  displayClassName,
  onBeginEdit,
}: InlineEditDisplayProps) {
  const hasValue = normalizedValue.trim().length > 0
  const displayValue = hasValue ? normalizedValue : emptyText

  const displayContent = (
    <div
      className={cn(
        'group/inline-edit relative w-full min-h-11 rounded-md px-2 py-1 -mx-2 text-left transition-colors',
        !readOnly && 'hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span
        className={cn(
          'block pr-5 text-sm transition-opacity',
          mode === 'textarea' && 'whitespace-pre-wrap',
          !hasValue && 'text-muted-foreground italic',
          isSaving && 'opacity-50',
          displayClassName,
        )}
      >
        {displayValue}
      </span>
      {!readOnly && (
        isSaving ? (
          <Loader2 className='pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground' />
        ) : (
          <Pencil className='pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity pointer-coarse:opacity-70 hover-capable:group-hover/inline-edit:opacity-70' />
        )
      )}
    </div>
  )

  if (readOnly) {
    return displayContent
  }

  return (
    <button type='button' onClick={onBeginEdit} className='w-full text-left'>
      {displayContent}
    </button>
  )
}

export function InlineEdit({
  value,
  onSave,
  schema,
  maxLength,
  mode = 'text',
  placeholder = '',
  emptyText,
  rows = 4,
  readOnly = false,
  className,
  displayClassName,
  inputClassName,
  ariaLabel,
  phone,
}: InlineEditProps) {
  const session = useInlineEditSession({
    mode,
    readOnly,
    value,
    emptyText,
    onSave,
    schema,
  })
  const editorProps = {
    draftValue: session.draftValue,
    onChange: session.setDraftValue,
    onBlur: session.handleBlur,
    onKeyDown: session.handleKeyDown,
    validationError: session.validationError,
    isSaving: session.isSaving,
    placeholder,
    ariaLabel,
    inputClassName,
    maxLength,
  }

  if (!session.isEditing) {
    return (
      <InlineEditDisplay
        normalizedValue={session.normalizedValue}
        emptyText={session.resolvedEmptyText}
        mode={mode}
        readOnly={readOnly}
        isSaving={session.isSaving}
        className={className}
        displayClassName={displayClassName}
        onBeginEdit={session.beginEdit}
      />
    )
  }

  if (mode === 'textarea') {
    return (
      <InlineTextareaInput
        {...editorProps}
        textareaRef={session.textareaRef}
        rows={rows}
      />
    )
  }

  return <InlineTextInput {...editorProps} inputRef={session.inputRef} phone={phone} />
}
