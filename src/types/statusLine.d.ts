// Status line command input type
export type StatusLineCommandInput = {
  session_id?: string
  cwd?: string
  branch?: string
  model?: string
  [key: string]: unknown
}