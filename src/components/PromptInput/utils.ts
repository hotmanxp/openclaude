import {
  hasUsedBackslashReturn,
  isShiftEnterKeyBindingInstalled,
} from '../../commands/terminalSetup/terminalSetup.js'
import type { Key } from '../../ink.js'
import type { AppState } from '../../state/AppState.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'
import {
  AGENT_COLORS,
  AGENT_COLOR_TO_THEME_COLOR,
  type AgentColorName,
} from '../../tools/AgentTool/agentColorManager.js'
import { getGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
import type { Theme } from '../../utils/theme.js'
/**
 * Helper function to check if vim mode is currently enabled
 * @returns boolean indicating if vim mode is active
 */
export function isVimModeEnabled(): boolean {
  const config = getGlobalConfig()
  return config.editorMode === 'vim'
}

export function getNewlineInstructions(): string {
  // Apple Terminal on macOS uses native modifier key detection for Shift+Enter
  if (env.terminal === 'Apple_Terminal' && process.platform === 'darwin') {
    return 'shift + ⏎ 换行'
  }

  // For iTerm2 and VSCode, show Shift+Enter instructions if installed
  if (isShiftEnterKeyBindingInstalled()) {
    return 'shift + ⏎ 换行'
  }

  // Otherwise show backslash+return instructions
  return hasUsedBackslashReturn()
    ? '\\⏎ 换行'
    : '反斜杠 (\\) + 回车 (⏎) 换行'
}

/**
 * True when the keystroke is a printable character that does not begin
 * with whitespace — i.e., a normal letter/digit/symbol the user typed.
 * Used to gate the lazy space inserted after an image pill.
 */
export function isNonSpacePrintable(input: string, key: Key): boolean {
  if (
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.return ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end
  ) {
    return false
  }
  return input.length > 0 && !/^\s/.test(input) && !input.startsWith('\x1b')
}

/**
 * A standalone color without a usable name should tint the prompt border,
 * not create an empty banner that changes the prompt layout.
 */
export function shouldShowStandaloneAgentBanner(
  standaloneName: string | undefined,
): boolean {
  return standaloneName !== undefined && standaloneName.trim().length > 0
}

/**
 * Resolves the border token with mode overrides before agent identity.
 * Active teams suppress saved standalone colors; invalid colors fall through
 * to the next eligible identity, then ultracode or the default prompt border.
 * AppState color priority is explicit self color, matching member color, then
 * dynamic teammate color. Leaders without a self ID use their leadAgentId.
 */
export function resolvePromptBorderColor({
  mode,
  inProcessTeammate,
  teammateColor,
  teamContext,
  teamName,
  standaloneColor,
  ultracodeActive,
}: {
  mode: PromptInputMode
  inProcessTeammate: boolean
  teammateColor?: string
  teamContext?: AppState['teamContext']
  teamName?: string
  standaloneColor?: string
  ultracodeActive?: boolean
}): keyof Theme {
  if (mode === 'bash') return 'bashBorder'
  if (inProcessTeammate) return 'promptBorder'

  const memberId = teamContext?.selfAgentId ?? teamContext?.leadAgentId
  const memberColor = memberId ? teamContext?.teammates[memberId]?.color : undefined

  // Team identity takes precedence over a saved standalone color.
  for (const identityColor of [
    teamContext?.selfAgentColor,
    memberColor,
    teammateColor,
    teamName || teamContext?.teamName ? undefined : standaloneColor,
  ]) {
    if (identityColor && AGENT_COLORS.includes(identityColor as AgentColorName)) {
      return AGENT_COLOR_TO_THEME_COLOR[identityColor as AgentColorName]
    }
  }
  return ultracodeActive ? 'ultracode' : 'promptBorder'
}
