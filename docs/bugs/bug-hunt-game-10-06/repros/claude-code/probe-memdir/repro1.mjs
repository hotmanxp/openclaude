// Repro: protectUrls placeholder collision in sanitizeMemoryText
const REDACTED_VALUE = '[REDACTED]'
function looksLikeSecretValue(){return false}

function protectUrls(value) {
  const urls = []
  const text = value.replace(/(?:https?:)?\/\/[^\s"'`,<>()]+/gi, rawUrl => {
    const index = urls.push(rawUrl) - 1
    return `__OPENCLAUDE_MEMORY_URL_${index}__`
  })
  return {
    text,
    restore: sanitized => urls.reduce(
      (current, url, index) => current.replace(`__OPENCLAUDE_MEMORY_URL_${index}__`, url),
      sanitized,
    ),
  }
}
function sanitize(value) {
  const p = protectUrls(value)
  let text = p.text
  text = p.restore(text)
  return text
}
console.log('IN :', JSON.stringify('literal marker __OPENCLAUDE_MEMORY_URL_0__ plus url https://example.com/a'))
console.log('OUT:', JSON.stringify(sanitize('literal marker __OPENCLAUDE_MEMORY_URL_0__ plus url https://example.com/a')))
