/**
 * Format a token count for compact display: 0→"0", 800→"800", 1500→"1.5k",
 * 12400→"12k", 1_500_000→"1.5M". Trims trailing ".0" so "1.0k" renders as "1k".
 *
 * Exported as a standalone helper (instead of inline in PromptInputFooter)
 * so it can be unit-tested without spinning up the Ink renderer.
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const s = (n / 1000).toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) + 'k' : s + 'k'
  }
  const s = (n / 1_000_000).toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) + 'M' : s + 'M'
}