import type { Command } from '../../commands.js'
import { BRAND_NAME } from '../../constants/product.js'

const stickers = {
  type: 'local',
  name: 'stickers',
  description: `Order ${BRAND_NAME} stickers`,
  supportsNonInteractive: false,
  load: () => import('./stickers.js'),
} satisfies Command

export default stickers
