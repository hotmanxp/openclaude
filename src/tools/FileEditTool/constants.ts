// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .claude/ folder
export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.claude/**'

// Permission pattern for granting session-level access to the global ~/.claude/ folder
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude/**'

// Legacy alias kept so existing session-level rules still work during migration.
// Tracks the rebrand target name so previously-OpenClaude-installed configs
// (which wrote `~/.openclaude/**` rules) continue to match in OpenCC.
export const LEGACY_GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.openclaude/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'

// Mirrors upstream's `eKn` (bundle @6290995). Each branch explains WHY the
// machine owner's approval did not carry the change through, and every one
// ends with the same imperative — retrying or routing around the approval is
// exactly the behaviour the owner is being asked to prevent.
// Lives here (not in either tool file) so Edit and Write share one copy
// without either importing the other.
export function stagedWriteMessage(
  filePath: string,
  wording: 'review' | 'card' | 'linked' | 'policy',
): string {
  switch (wording) {
    case 'card':
      return `Not applied: ${filePath} was NOT modified. In the Claude desktop app, a change to a Claude Code settings file applies only when the user approves that edit on its permission card. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'linked':
      return `Not applied: ${filePath} was NOT modified. The user approved this edit on its permission card, but this path reaches a Claude Code settings file through a symbolic link, so the approval does not apply it. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'policy':
      return `Not applied: ${filePath} was NOT modified. The user approved this edit on its permission card, but this path is, or may be, a managed policy settings file or the --settings file, so the approval does not apply it. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'review':
      return `Staged for review: ${filePath} was NOT modified. Changes to Claude Code settings files made without the owner of this computer approving them in person are held for their review; the owner applies or discards them, and the change takes effect only if they accept it. Do not retry the edit or try to make the same change another way.`
  }
}
