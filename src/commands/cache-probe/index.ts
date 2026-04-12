import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const cacheProbe: Command = {
  type: 'local',
  name: 'cache-probe',
  description: '发送相同请求以测试提示缓存（结果写入调试日志）',
  argumentHint: '[model] [--no-key]',
  isEnabled: () =>
    isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB),
  supportsNonInteractive: false,
  load: () => import('./cache-probe.js'),
}

export default cacheProbe
