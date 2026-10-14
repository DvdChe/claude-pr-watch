export type MrState = 'opened' | 'draft' | 'merged' | 'closed'

export type TrackedMr = {
  host: string
  project: string
  iid: number
  title?: string
  state: MrState
  /** head pipeline status as GitLab reports it (running, success, failed, …) */
  pipeline?: string
  approved?: boolean
  /** number of unresolved discussion threads on the MR */
  unresolved?: number
  /** last poll failed for this MR */
  error?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': { mrs: TrackedMr[] }
  }
}
