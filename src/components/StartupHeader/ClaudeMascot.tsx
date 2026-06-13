// @ts-nocheck
import { Text } from '../../ink.js'
import { getTheme } from '../../utils/theme.js'
import { useTheme } from '../design-system/ThemeProvider.js'

// 3-row Claude Code mascot sprite (verbatim from upstream claude splash).
// Each row is a fixed string; do NOT edit characters — they are designed
// to compose with the brand text on the right at the default terminal
// font width.
const CLAUDE_MASCOT_ROWS = [
  ' ▐▛███▜▌ ',
  '▝▜█████▛▘',
  '  ▘▘ ▝▝',
] as const

export function ClaudeMascot() {
  const [themeName] = useTheme()
  const theme = getTheme(themeName)
  return (
    <>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[0]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[1]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[2]}</Text>
    </>
  )
}
