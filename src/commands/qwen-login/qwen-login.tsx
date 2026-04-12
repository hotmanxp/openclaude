import * as React from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  getQwenOAuthClient,
  qwenOAuth2Events,
  QwenOAuth2Event,
} from '../../qwen/index.js'

type QwenLoginResult =
  | { type: 'success' }
  | { type: 'cancel' }
  | { type: 'error'; message: string }

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
): Promise<React.ReactNode> {
  return (
    <QwenLogin
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Login interrupted')
          return
        }

        if (result.type === 'error') {
          onDone(result.message)
          return
        }

        onDone('Qwen 登录成功')
      }}
    />
  )
}

export function QwenLogin(props: {
  onDone: (result: QwenLoginResult) => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<string>('正在初始化...')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        // Set up event listeners
        qwenOAuth2Events.on(QwenOAuth2Event.AuthUri, data => {
          if (!cancelled) {
            setStatus(`请在浏览器中打开: ${data.verification_uri_complete}`)
          }
        })

        qwenOAuth2Events.on(QwenOAuth2Event.AuthProgress, (progress: string) => {
          if (!cancelled) {
            setStatus(`等待授权... ${progress}`)
          }
        })

        setStatus('正在获取 OAuth 客户端...')

        // Get Qwen OAuth client - this triggers device flow if needed
        const client = await getQwenOAuthClient()

        setStatus('正在获取访问令牌...')

        // Verify we got a token
        const { token } = await client.getAccessToken()

        if (!cancelled) {
          if (token) {
            props.onDone({ type: 'success' })
          } else {
            props.onDone({ type: 'error', message: '未能获取访问令牌' })
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '未知错误'
          setError(message)
          props.onDone({ type: 'error', message })
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Dialog
      title="Qwen 登录"
      onCancel={() => props.onDone({ type: 'cancel' })}
      color="permission"
    >
      <Text>状态: {status}</Text>
      {error && <Text color="red">错误: {error}</Text>}
    </Dialog>
  )
}
