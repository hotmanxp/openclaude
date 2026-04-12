import type { Command } from '../../commands.js'
import { BRAND_NAME } from '../../constants/product.js'

const stickers = {
  type: 'local',
  name: 'stickers',
  description: `订购 ${BRAND_NAME} 贴纸`,
  supportsNonInteractive: false,
  load: () => import('./stickers.js'),
} satisfies Command

export default stickers
