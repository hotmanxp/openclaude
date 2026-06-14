import { describe, expect, test } from 'bun:test'
import { DESCRIPTION } from './prompt.js'

describe('FileReadTool prompt', () => {
  test('DESCRIPTION matches upstream 2.1.177 canonical text', () => {
    expect(DESCRIPTION).toBe(
      'Reads a file from the local filesystem. You can access any file directly by using this tool.',
    )
  })
})
