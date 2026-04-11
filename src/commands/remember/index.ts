import type { Command } from '../../commands.js'

const remember: Command = {
  type: 'local',
  name: 'remember',
  description: 'Save information to memory',
  argumentHint: '[user|feedback|project|reference] <content>',
  supportsNonInteractive: true,
  load: () => import('./remember.js'),
}

export default remember
