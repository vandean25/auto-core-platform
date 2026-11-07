/** Pure cache patches for inspection checklist edits (ADR-0036 R1): only the edited fields of the edited items change. */
export type ChecklistItemEdit = { id: string; passed?: boolean | null; notes?: string | null }

type ChecklistLike = { items: Array<{ id: string; passed?: boolean | null; notes?: string | null }> }

export function applyChecklistEdits<T extends ChecklistLike>(checklist: T, edits: ChecklistItemEdit[]): T {
  const byId = new Map(edits.map((edit) => [edit.id, edit]))
  return {
    ...checklist,
    items: checklist.items.map((item) => {
      const edit = byId.get(item.id)
      if (!edit) return item
      return {
        ...item,
        ...(edit.passed !== undefined && { passed: edit.passed }),
        ...(edit.notes !== undefined && { notes: edit.notes }),
      }
    }),
  }
}

/** Puts back the edited fields from `snapshot`; items and fields this edit did not touch keep their current value. */
export function revertChecklistEdits<T extends ChecklistLike>(
  checklist: T,
  edits: ChecklistItemEdit[],
  snapshot: T,
): T {
  const before = new Map(snapshot.items.map((item) => [item.id, item]))
  const byId = new Map(edits.map((edit) => [edit.id, edit]))
  return {
    ...checklist,
    items: checklist.items.map((item) => {
      const edit = byId.get(item.id)
      const previous = before.get(item.id)
      if (!edit || !previous) return item
      return {
        ...item,
        ...(edit.passed !== undefined && { passed: previous.passed }),
        ...(edit.notes !== undefined && { notes: previous.notes }),
      }
    }),
  }
}
