import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'
import type { MrState, TrackedMr } from '../types'

const POLL_MS = 60_000
const MR_URL = /https?:\/\/([\w.-]+)\/((?:[\w.-]+\/)+[\w.-]+)\/-\/merge_requests\/(\d+)/
const PR_URL = /https?:\/\/(github\.com)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/

const isGitHub = (mr: TrackedMr): boolean => mr.host === 'github.com'

const refOf = (mr: TrackedMr): string => (isGitHub(mr) ? `#${mr.iid}` : `!${mr.iid}`)

const urlOf = (mr: TrackedMr): string =>
  isGitHub(mr)
    ? `https://github.com/${mr.project}/pull/${mr.iid}`
    : `https://${mr.host}/${mr.project}/-/merge_requests/${mr.iid}`

type IconSet = {
  prefix: string
  merged: string
  closed: string
  draft: string
  success: string
  failed: string
  canceled: string
  running: string
  approved: string
  thread: string
}

// Nerd Font glyphs (needs a Nerd Font terminal, e.g. Hack Nerd Font)
const NERD: IconSet = {
  prefix: '',
  merged: '',
  closed: '',
  draft: '',
  success: '',
  failed: '',
  canceled: '',
  running: '',
  approved: '',
  thread: '',
}

const EMOJI: IconSet = {
  prefix: '\u{1F500}',
  merged: '✔',
  closed: '✖',
  draft: '✏',
  success: '✅',
  failed: '❌',
  canceled: '⚪',
  running: '⏳',
  approved: '\u{1F44D}',
  thread: '\u{1F4AC}',
}

const mrs = atom({ plugin: 'pr-watch', key: 'mrs' } as const, [])

const sameMr = (a: TrackedMr) => (b: TrackedMr) =>
  a.host === b.host && a.project === b.project && a.iid === b.iid

type Segment = { text: string; color?: Color; dim?: boolean }

const pipeSegment = (status: string | undefined, icons: IconSet): Segment | undefined => {
  if (status === undefined) return undefined
  if (status === 'success') return { text: icons.success, color: 'success' }
  if (status === 'failed') return { text: icons.failed, color: 'error' }
  if (status === 'canceled' || status === 'skipped') return { text: icons.canceled, color: 'inactive' }
  return { text: icons.running, color: 'warning' }
}

const TITLE_MAX = 32

const shortTitle = (title: string | undefined): string => {
  if (title === undefined) return ''
  const clean = title.replace(/^(draft|wip):\s*/i, '').trim()
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean
}

// everything shown after the clickable ref: title, state and badges
const segmentsOf = (mr: TrackedMr, icons: IconSet): Segment[] => {
  const segments: Segment[] = []
  const title = shortTitle(mr.title)
  if (title !== '') segments.push({ text: title, dim: true })
  if (mr.state === 'merged') segments.push({ text: icons.merged, color: 'merged' })
  else if (mr.state === 'closed') segments.push({ text: icons.closed, color: 'error' })
  else {
    if (mr.state === 'draft') segments.push({ text: icons.draft, color: 'subtle' })
    const pipe = pipeSegment(mr.pipeline, icons)
    if (pipe !== undefined) segments.push(pipe)
    if (mr.approved === true) segments.push({ text: icons.approved, color: 'success' })
    if (mr.unresolved !== undefined && mr.unresolved > 0)
      segments.push({ text: `${icons.thread}${mr.unresolved}`, color: 'warning' })
    if (mr.error === true) segments.push({ text: '⚠', color: 'warning' })
  }
  return segments
}

const parseRef = (arg: string, gitlabHost: string, defaultProject: string): TrackedMr | undefined => {
  const url = arg.match(MR_URL) ?? arg.match(PR_URL)
  if (url !== null)
    return { host: url[1] ?? '', project: url[2] ?? '', iid: Number(url[3]), state: 'opened' }
  const scoped = arg.match(/^([\w.-]+(?:\/[\w.-]+)+)([!#])(\d+)$/)
  if (scoped !== null)
    return {
      host: scoped[2] === '#' ? 'github.com' : gitlabHost,
      project: scoped[1] ?? '',
      iid: Number(scoped[3]),
      state: 'opened',
    }
  const bare = arg.match(/^!?(\d+)$/)
  if (bare !== null && defaultProject !== '')
    return { host: gitlabHost, project: defaultProject, iid: Number(bare[1]), state: 'opened' }
  return undefined
}

type CheckRollupItem = { status?: string; conclusion?: string | null; state?: string }

const rollupStatus = (checks: readonly CheckRollupItem[] | undefined): string | undefined => {
  if (checks === undefined || checks.length === 0) return undefined
  const outcomes = checks.map(check => (check.conclusion ?? check.state ?? check.status ?? '').toUpperCase())
  if (outcomes.some(one => one === 'FAILURE' || one === 'ERROR' || one === 'TIMED_OUT')) return 'failed'
  if (outcomes.every(one => one === 'SUCCESS' || one === 'NEUTRAL' || one === 'SKIPPED')) return 'success'
  if (outcomes.every(one => one === 'CANCELLED' || one === 'CANCELED')) return 'canceled'
  return 'running'
}

const fetchGitHubPr = async ($: EngineInterface, mr: TrackedMr): Promise<Partial<TrackedMr>> => {
  try {
    const got = await $.process.run([
      'gh', 'pr', 'view', String(mr.iid), '--repo', mr.project,
      '--json', 'state,title,isDraft,reviewDecision,statusCheckRollup',
    ])
    if (got.exitCode !== 0) return { error: true }
    const data = JSON.parse(got.stdout) as {
      title?: string
      state?: string
      isDraft?: boolean
      reviewDecision?: string
      statusCheckRollup?: CheckRollupItem[]
    }
    const state: MrState =
      data.state === 'MERGED' ? 'merged'
      : data.state === 'CLOSED' ? 'closed'
      : data.isDraft === true ? 'draft'
      : 'opened'
    let unresolved: number | undefined
    if (state === 'opened' || state === 'draft') {
      const [owner = '', name = ''] = mr.project.split('/')
      const threads = await $.process.run([
        'gh', 'api', 'graphql', '-f',
        `query=query{repository(owner:"${owner}",name:"${name}"){pullRequest(number:${mr.iid}){reviewThreads(first:100){nodes{isResolved}}}}}`,
      ])
      if (threads.exitCode === 0) {
        const parsed = JSON.parse(threads.stdout) as {
          data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved?: boolean }[] } } } }
        }
        const nodes = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
        unresolved = nodes.filter(node => node.isResolved === false).length
      }
    }
    return {
      title: data.title,
      state,
      pipeline: rollupStatus(data.statusCheckRollup),
      approved: data.reviewDecision === 'APPROVED',
      unresolved,
      error: false,
    }
  } catch {
    return { error: true }
  }
}

const fetchMr = async ($: EngineInterface, mr: TrackedMr): Promise<Partial<TrackedMr>> => {
  if (isGitHub(mr)) return fetchGitHubPr($, mr)
  const path = `projects/${encodeURIComponent(mr.project)}/merge_requests/${mr.iid}`
  try {
    const got = await $.process.run(['glab', 'api', path, '--hostname', mr.host])
    if (got.exitCode !== 0) return { error: true }
    const data = JSON.parse(got.stdout) as {
      title?: string
      state?: string
      draft?: boolean
      head_pipeline?: { status?: string } | null
    }
    const state: MrState =
      data.state === 'merged' ? 'merged'
      : data.state === 'closed' ? 'closed'
      : data.draft === true ? 'draft'
      : 'opened'
    let approved: boolean | undefined
    let unresolved: number | undefined
    if (state === 'opened' || state === 'draft') {
      const appr = await $.process.run(['glab', 'api', `${path}/approvals`, '--hostname', mr.host])
      if (appr.exitCode === 0)
        approved = (JSON.parse(appr.stdout) as { approved?: boolean }).approved === true
      const disc = await $.process.run([
        'glab', 'api', `${path}/discussions?per_page=100`, '--hostname', mr.host,
      ])
      if (disc.exitCode === 0) {
        const threads = JSON.parse(disc.stdout) as {
          notes?: { resolvable?: boolean; resolved?: boolean }[]
        }[]
        unresolved = threads.filter(thread =>
          (thread.notes ?? []).some(note => note.resolvable === true && note.resolved === false),
        ).length
      }
    }
    return {
      title: data.title,
      state,
      pipeline: data.head_pipeline?.status,
      approved,
      unresolved,
      error: false,
    }
  } catch {
    return { error: true }
  }
}

const journal: string[] = []

const logEvent = (entry: string): void => {
  journal.push(`${new Date().toISOString()} ${entry}`)
  if (journal.length > 100) journal.shift()
}

let isPolling = false

const poll = async ($: EngineInterface): Promise<void> => {
  if (isPolling) return
  isPolling = true
  try {
    const list = (await read($, mrs)) as readonly TrackedMr[]
    for (const mr of list) {
      if (mr.state === 'merged' || mr.state === 'closed') continue
      const got = await fetchMr($, mr)
      await update($, mrs, current =>
        current.map(one => (sameMr(mr)(one) ? { ...one, ...got } : one)),
      )
    }
    const polled = (await read($, mrs)) as readonly TrackedMr[]
    logEvent(`poll done: ${polled.map(mr => `${refOf(mr)} ${mr.state}`).join(', ') || 'nothing tracked'}`)
  } catch (error) {
    logEvent(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isPolling = false
  }
}

export const register: Register = (on, options) => {
  const icons = options.icons === 'emoji' ? EMOJI : NERD
  const gitlabHost =
    typeof options.gitlabHost === 'string' && options.gitlabHost !== '' ? options.gitlabHost : 'gitlab.com'
  const defaultProject = typeof options.defaultProject === 'string' ? options.defaultProject : ''
  logEvent(`module loaded (icons: ${options.icons === 'emoji' ? 'emoji' : 'nerd'}, gitlab: ${gitlabHost})`)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pr-track',
      description: 'Track a GitLab MR or GitHub PR in the band (URL, group/project!iid, owner/repo#number or !iid)',
    })
    await $.command.register({
      name: 'pr-untrack',
      description: 'Stop tracking an MR/PR (!iid, #number or all); no argument lists tracked ones',
    })
    await $.command.register({
      name: 'pr-untrack-merged',
      description: 'Stop tracking every merged (and closed) MR/PR',
    })
    await $.command.register({
      name: 'pr-debug',
      description: 'Show the pr-watch journal (loads, polls, errors)',
    })
    // the display moved to the AbovePrompt band; drop any status line a
    // previous version of this plugin left pinned
    $.ui.status(undefined)
    $.clock.every(POLL_MS, () => poll($))
    void poll($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = (await read($, mrs)) as readonly TrackedMr[]
    if (list.length === 0 || e.props.hasSurvey) return next(e)
    const { Box, Link, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>{icons.prefix} </Text>
        {list.flatMap((mr, index) => [
          ...(index > 0 ? [<Text dimColor> │ </Text>] : []),
          <Link href={urlOf(mr)} label={refOf(mr)} />,
          ...segmentsOf(mr, icons).map(segment => (
            <Text color={segment.color} dimColor={segment.dim === true}>
              {' '}
              {segment.text}
            </Text>
          )),
        ])}
      </Box>
    )
  })

  on('command.run', { command: 'pr-untrack-merged' }, async $ => {
    const list = (await read($, mrs)) as readonly TrackedMr[]
    const done = list.filter(mr => mr.state === 'merged' || mr.state === 'closed')
    if (done.length === 0) return { text: 'No merged or closed MRs tracked.' }
    await update($, mrs, current =>
      current.filter(mr => mr.state !== 'merged' && mr.state !== 'closed'),
    )

    return { text: `Untracked ${done.map(mr => refOf(mr)).join(', ')}.` }
  })

  on('command.run', { command: 'pr-debug' }, () => ({
    text: journal.length === 0 ? 'Journal is empty.' : journal.join('\n'),
  }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny === undefined && ran.isError === undefined && /\b(mr|pr)\s+create\b/.test(e.command)) {
        const output =
          ran.text ?? (typeof (ran.result as { stdout?: unknown })?.stdout === 'string'
            ? ((ran.result as { stdout: string }).stdout)
            : '')
        const found = [
          ...output.matchAll(new RegExp(MR_URL, 'g')),
          ...output.matchAll(new RegExp(PR_URL, 'g')),
        ]
        if (found.length > 0) {
          await update($, mrs, current => {
            const grown = [...current]
            for (const match of found) {
              const [, host = '', project = '', iid = ''] = match
              if (host === '' || project === '' || iid === '') continue
              const mr: TrackedMr = { host, project, iid: Number(iid), state: 'opened' }
              if (!grown.some(sameMr(mr))) grown.push(mr)
            }
            return grown
          })
          void poll($)
        }
      }
    } catch {
      // tracking must never break the tool call
    }

    return ran
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('command.run', { command: 'pr-track' }, async ($, e) => {
    const mr = parseRef(e.args.trim(), gitlabHost, defaultProject)
    if (mr === undefined)
      return {
        text: 'Usage: /pr-track <MR/PR URL | group/project!iid | owner/repo#number | !iid>'
          + (defaultProject === '' ? ' (bare !iid needs the defaultProject setting)' : ''),
      }
    await update($, mrs, current => (current.some(sameMr(mr)) ? current : [...current, mr]))
    void poll($)

    return { text: `Tracking ${mr.project}${refOf(mr)} on ${mr.host}.` }
  })

  on('command.run', { command: 'pr-untrack' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') {
      const list = (await read($, mrs)) as readonly TrackedMr[]
      if (list.length === 0) return { text: 'No tracked MRs.' }
      const lines = list.map(
        mr => `${mr.project}${refOf(mr)} — ${mr.state}${mr.title !== undefined ? ` — ${mr.title}` : ''}`,
      )
      return { text: lines.join('\n') }
    }
    if (arg === 'all') {
      await update($, mrs, () => [])
      return { text: 'Cleared all tracked MRs.' }
    }
    const iid = Number(arg.replace(/^[!#]/, ''))
    if (Number.isNaN(iid)) return { text: 'Usage: /pr-untrack <!iid | #number | all>' }
    await update($, mrs, current => current.filter(mr => mr.iid !== iid))

    return { text: `Untracked ${arg.startsWith('#') ? '#' : '!'}${iid}.` }
  })
}
