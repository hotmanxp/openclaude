import type { Command } from '../../commands.js';
import { BRAND_NAME } from '../../constants/product.js';
const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: `管理 ${BRAND_NAME} 插件`,
  immediate: true,
  load: () => import('./plugin.js')
} satisfies Command;
export default plugin;
