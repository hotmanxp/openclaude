import type { Command } from '../../commands.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: '孵化、培养和管理你的 Open Open CC 伙伴',
  immediate: true,
  argumentHint: '[status|mute|unmute|help]',
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
