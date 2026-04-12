export type ViewState = {
  type: string
  [key: string]: unknown
}

export type MarketplacePlugin = {
  id: string
  name: string
  [key: string]: unknown
}

export type PluginSettingsProps = {
  onComplete: (result?: string) => void
  args: string
  showMcpRedirectMessage?: boolean
}
