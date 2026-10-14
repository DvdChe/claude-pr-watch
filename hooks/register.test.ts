import { expect, test } from 'claude-code/testing'
import type { TrackedMr } from '../types'

test('tracks the MR url printed by glab mr create', async ($, on) => {
  let written: readonly TrackedMr[] | undefined
  on('state.set', ($, e, next) => {
    written = e.value as readonly TrackedMr[]
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: {
      stdout: 'https://gitlab.com/acme/devops/-/merge_requests/5634\n',
      stderr: '',
    },
  }))

  await $.tool.call({
    tool: 'Bash',
    command: 'glab mr create --title test --fill',
  })

  expect(written?.some(mr => mr.iid === 5634 && mr.project === 'acme/devops')).toBe(true)
})

test('tracks the PR url printed by gh pr create', async ($, on) => {
  let written: readonly TrackedMr[] | undefined
  on('state.set', ($, e, next) => {
    written = e.value as readonly TrackedMr[]
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: {
      stdout: 'https://github.com/acme/some-repo/pull/42\n',
      stderr: '',
    },
  }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })

  expect(written?.some(mr => mr.iid === 42 && mr.host === 'github.com' && mr.project === 'acme/some-repo')).toBe(true)
})

test('ignores bash calls that are not mr create', async ($, on) => {
  let written: readonly TrackedMr[] | undefined
  on('state.set', ($, e, next) => {
    written = e.value as readonly TrackedMr[]
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: {
      stdout: 'https://gitlab.com/acme/devops/-/merge_requests/9999\n',
      stderr: '',
    },
  }))

  await $.tool.call({ tool: 'Bash', command: 'glab mr view 9999' })

  expect(written).toBe(undefined)
})
