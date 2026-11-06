/** The help sheet has an ordinary trigger (account menu) next to the `?` key; both open the same sheet. */
export const SHORTCUT_HELP_OPEN_EVENT = 'acp:open-shortcut-help'

export function openShortcutHelp(): void {
  window.dispatchEvent(new Event(SHORTCUT_HELP_OPEN_EVENT))
}
