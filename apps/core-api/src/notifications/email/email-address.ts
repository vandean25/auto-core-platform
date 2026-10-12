/**
 * One plain address in RFC 5322 dot-atom form. The local part allows the atext characters, but no
 * spaces, commas, quotes, angle brackets, colons or backslashes, so a stored value can never name a
 * second recipient or break a header (AUT-356). The domain stays a strict hostname.
 */
const PLAIN_ADDRESS =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function isPlainEmailAddress(value: string): boolean {
  return PLAIN_ADDRESS.test(value);
}
