import type { Command } from '../../commands.js'

const wiki = {
  type: 'local-jsx',
  name: 'wiki',
  description: '初始化和检查 OpenCC 项目 wiki',
  argumentHint: '[init|status]',
  immediate: true,
  load: () => import('./wiki.js'),
} satisfies Command

export default wiki
