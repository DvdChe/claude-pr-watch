# pr-watch

Live GitLab MR / GitHub PR tracking for [Claude Code](https://claude.com/claude-code) sessions.

Every merge request or pull request created during a session (`glab mr create`, `gh pr create`) is picked up automatically and watched in a band above the prompt:

```
 !1024 fix(api): retry uploads on 5xx…   │ #42 docs: update install guide…  │ !1037 feat(cli): add a --json flag 
```

- **Clickable ids** — `!1024` opens the MR on GitLab, `#42` the PR on GitHub (OSC 8 hyperlinks)
- **CI status** at a glance: passed · running · failed · canceled, in your theme's colors
- **Approvals** and **unresolved review threads**, refreshed every minute
- **Merged / closed** MRs stay visible until untracked; state survives plugin reloads

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pr-watch --marketplace DvdChe/claude-pr-watch
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it available in all your sessions).

### Requirements

- [`glab`](https://gitlab.com/gitlab-org/cli) authenticated on your GitLab host, for GitLab MRs
- [`gh`](https://cli.github.com/) authenticated on github.com, for GitHub PRs
- A [Nerd Font](https://www.nerdfonts.com/) terminal font for the default icons — or switch the `Icon set` option to `emoji`

Only the forges you actually track need their CLI.

## Commands

| Command | What it does |
|---|---|
| `/pr-track <ref>` | Track an MR/PR: a full URL, `group/project!iid`, `owner/repo#number`, or a bare `!iid` (needs the `Default GitLab project` setting) |
| `/pr-untrack <!iid \| #number \| all>` | Stop tracking; with no argument, lists what is tracked |
| `/pr-debug` | Show the plugin's journal (loads, polls, errors) |

MRs/PRs created in the session via `glab mr create` or `gh pr create` are tracked automatically — no command needed.

## Configuration

In `/config`, under the plugin's rows:

| Option | Default | Meaning |
|---|---|---|
| Icon set | `nerd` | `nerd` (Nerd Font glyphs) or `emoji` |
| GitLab host | `gitlab.com` | GitLab hostname used by `/pr-track` shorthand refs (self-hosted instances welcome) |
| Default GitLab project | *(empty)* | `group/project` assumed for bare `!iid` refs |

URLs always carry their own host, so auto-tracking and URL refs work on any GitLab instance with no configuration.

## Development

```sh
claude plugin validate .   # manifest + hooks static checks
claude plugin test .       # runs hooks/*.test.ts against the engine
```

The band is drawn by a `ui.render` hook on `AbovePrompt`; MR state lives in session-scoped plugin state and is polled through `glab api` / `gh api` on a 60 s timer.

## License

MIT
