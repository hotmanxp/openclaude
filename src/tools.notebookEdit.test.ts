import { expect, mock, test } from 'bun:test'
import { existsSync } from 'fs'
import { getEmptyToolPermissionContext } from './Tool.js'

// Mirror tools.lsp.test.ts: importing tools.js pulls in the LSP manager, which
// must be stubbed so the pool can be assembled without a real language server.
mock.module('./services/lsp/manager.js', () => ({
  getInitializationStatus: () => ({ status: 'success' }),
  getLspServerManager: () => undefined,
  isLspConnected: () => false,
  reinitializeLspServerManager: () => {},
  waitForInitialization: async () => {},
}))

const { getAllBaseTools, getTools } = await import('./tools.js')

// NotebookEdit is intentionally unregistered (see the note above
// getAllBaseTools in tools.ts). Its source is kept, so these tests pin both
// halves of that decision: the tool must not reach the model, and the file
// must still exist.
test('NotebookEditTool is absent from the base tool pool', () => {
  expect(getAllBaseTools().map(tool => tool.name)).not.toContain('NotebookEdit')
})

test('NotebookEditTool is absent from usable tools', () => {
  const permissionContext = getEmptyToolPermissionContext()
  expect(getTools(permissionContext).map(tool => tool.name)).not.toContain(
    'NotebookEdit',
  )
})

test('NotebookEdit source is retained on disk', () => {
  expect(existsSync('src/tools/NotebookEditTool/NotebookEditTool.ts')).toBe(true)
})

test('the REPL primitive pool does not expose NotebookEdit', async () => {
  const { getReplPrimitiveTools } = await import(
    './tools/REPLTool/primitiveTools.js'
  )
  expect(getReplPrimitiveTools().map(tool => tool.name)).not.toContain(
    'NotebookEdit',
  )
})