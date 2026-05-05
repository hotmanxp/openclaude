import type { Command } from '../../commands.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  // [FORK_SUBAGENT] was: aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
  aliases: [] as string[],
  description: '在当前对话点创建分支',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
