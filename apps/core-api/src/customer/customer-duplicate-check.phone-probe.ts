/** Single-space variants of a digit tail so DB rows with spaces still match `contains`. */
export function phoneDigitTailContainsVariants(tail: string): string[] {
  const variants = new Set<string>([tail]);
  for (let index = 1; index < tail.length; index += 1) {
    variants.add(`${tail.slice(0, index)} ${tail.slice(index)}`);
  }
  return [...variants];
}
