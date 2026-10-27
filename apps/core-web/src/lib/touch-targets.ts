/**
 * Class for the root of a page that is used on a phone: below `sm` every button, select and text input in it is at
 * least 44px high (touch target), whatever size the control was written with. Desktop is unchanged.
 */
export const PHONE_TOUCH_CONTROLS =
  'max-sm:[&_button]:min-h-11 max-sm:[&_select]:min-h-11 max-sm:[&_textarea]:min-h-11 max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11'
