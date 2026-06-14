import { describe, expect, test } from 'bun:test'
import { DESCRIPTION } from './prompt.js'

describe('FileWriteTool prompt', () => {
  test('DESCRIPTION matches upstream 2.1.177 canonical text', () => {
    expect(DESCRIPTION).toBe(
      'Writes a file to the local filesystem, overwriting if one exists.',
    )
  })
})
