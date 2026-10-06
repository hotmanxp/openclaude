import type { Command } from '../../commands.js'

const mods = {
  type: 'local',
  name: 'mods',
  description: '查看与管理已加载的 mods（reload / unload）',
  argumentHint: '[reload | unload <name>]',
  supportsNonInteractive: true,
  load: () => import('./mods.js'),
} satisfies Command

export default mods
