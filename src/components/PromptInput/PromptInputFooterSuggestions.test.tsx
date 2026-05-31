// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { renderToString } from '../../utils/staticRender.js'
import {
  PromptInputFooterSuggestions,
  type SuggestionItem,
} from './PromptInputFooterSuggestions.js'

describe('PromptInputFooterSuggestions', () => {
  it('renders selected suggestion with highlight styling', async () => {
    const suggestions: SuggestionItem[] = [
      {
        id: 'command-help',
        displayText: '/help',
        description: 'Show help',
      },
      {
        id: 'command-doctor',
        displayText: '/doctor',
        description: 'Run diagnostics',
      },
    ]

    const output = await renderToString(
      <PromptInputFooterSuggestions
        suggestions={suggestions}
        selectedSuggestion={1}
      />,
      80,
    )

    // Selected item (/doctor) should be bold, unselected (/help) should be dim
    expect(output).toContain('/doctor')
    expect(output).toContain('/help')
  })
})
