# socialcrawl

socialcrawl runs social media research from your terminal or your coding agent. You set your SocialCrawl key once, `init` installs the workflows into your agents, and each workflow reads X, TikTok, Instagram, YouTube, Reddit or LinkedIn and writes a report with its raw data.

```bash
npx -y socialcrawl@latest init
```

Not on npm yet (27/11/2026). Until the first release, run it from GitHub: `npx -y github:socialcrawl/cli init`.

## What `init` does

1. Uses `SOCIALCRAWL_API_KEY` or a key you saved before. If there is none, it asks you to paste a key, or to press Enter and sign in by email with a link and a 6-digit code (a free key with 100 credits, no card).
2. Checks the key with a free balance read before it saves it to `~/.socialcrawl/config.json`, never into a project folder.
3. Finds the coding agents on your machine (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot) and installs the workflows from [socialcrawl/workflows](https://github.com/socialcrawl/workflows) into each one.

Then ask your agent "what went viral about AI coding tools this week?", or run a workflow yourself:

```bash
socialcrawl social-viral "AI coding tools"
```

## Workflows

| Workflow | Give it | Default run, measured | At most |
| --- | --- | --- | --- |
| [`social-viral`](https://github.com/socialcrawl/workflows/tree/main/skills/social-viral) | a topic | 73 credits | 100 |
| [`tiktok-marketing`](https://github.com/socialcrawl/workflows/tree/main/skills/tiktok-marketing) | a keyword | 40 credits | 55 |
| [`instagram-marketing`](https://github.com/socialcrawl/workflows/tree/main/skills/instagram-marketing) | a keyword | 48 credits | 60 |
| [`youtube-marketing`](https://github.com/socialcrawl/workflows/tree/main/skills/youtube-marketing) | a keyword | 41 credits | 49 |

Each was measured once on "AI coding tools" on 27/11/2026 with nothing cached; each workflow's page gives its request ids. Every default run fits in the 100 credits a new account starts with. `socialcrawl --help` lists the workflows your version has.

## Example

```text
$ socialcrawl social-viral "AI coding tools"
This run reads about 67 credits (at most 100). You have …
search: 6 calls, 18 credits
baseline: 36 calls, 49 credits
amplifiers: 2 calls, 2 credits
sizes: 4 calls, 4 credits
12 posts broke out at 3x their author's usual reach, on 5 platforms
  TikTok: @benkimball.ai at 110x its author's median views over 17 earlier posts
  YouTube: @greatlearning at 44x its author's median views over 12 earlier posts
  TikTok: @ai.honeycove at 43.7x its author's median views over 9 earlier posts
  Instagram: @benkimball.ai at 33.3x its author's median likes over 18 earlier posts
Not read: 5 calls (budget). Not verified: 17 items. The report lists each one.
Cost: 73 credits, 48 calls, 198.6 s.
Report: socialcrawl-runs/social-viral-ai-coding-tools-2026-11-27/report.html
```

![The card of that run](docs/social-viral-card.svg)

The run folder holds:

| File | What is in it |
| --- | --- |
| `report.html` | the report on one page that works offline, with charts; every number links to the request it came from |
| `report.md` | the same report as text, for your agent or a doc |
| `card.svg` | the card above, 1200 × 675 |
| `data/*.csv` | every row the run read, so you keep the raw data |
| `responses.jsonl` | every API response, one per line, with its request id |
| `evidence.json` | each claim, its request ids, and what could not be verified |
| `run.json` | the inputs, the credits and calls of each stage, the time |

## Options

```text
socialcrawl init                     set up the key and install the workflows
  --project                          install into this project's folders, not your home folder
  --no-install                       set up the key only
  --skills-from <dir>                install from a local copy of socialcrawl/workflows
socialcrawl whoami                   the key in use and its credits
socialcrawl <workflow> "<input>"     run a workflow
  --deep                             the research-grade run: reads more, costs more
  --budget <n>                       the most credits this run may spend
  --since <date> --until <date>      the window, YYYY-MM-DD, where the workflow takes one
  --out <dir>                        the run folder (default ./socialcrawl-runs/<workflow>-<input>-<date>/)
  --plan                             print the free quote, stage by stage, and spend nothing
  --open                             open report.html when done
  --json                             print run.json instead of the summary
  --no-cache                         read everything fresh
```

Every run prints its price first, then runs. A run never spends more than its budget (the workflow's default, `--deep`'s, or `--budget`) or your balance. When your balance is short, it reads what the balance covers, says what it left out and ends with the link to top up.

| Exit code | Means |
| --- | --- |
| 0 | done |
| 1 | an error, or no key set |
| 2 | bad input: an unknown workflow or option, or a missing input |
| 3 | out of credits; the offer and what was read are printed |

## What it stores and sends

- `~/.socialcrawl/config.json`, readable by you only where the system allows it: your API key, or the tokens of an email sign-in (refreshed when they expire), and the list of agents `init` installed into. Delete the folder to remove them.
- Run folders where you run the command: the posts, comments and numbers the run read, including other people's public posts. They stay on your machine.
- Each workflow's `SKILL.md` and `README.md`, copied into your agents' skills folders.
- Requests go to `https://www.socialcrawl.dev/v1` with your key, and name the client as `socialcrawl-cli/<version>`. `init` also downloads the workflows from GitHub. Nothing else is sent: no analytics, no telemetry.

## Develop

Node 20 or later.

```bash
npm install
npm test          # tsc --strict, then node --test
npm run build     # dist/cli.js
```

Workflows live in `src/workflows/<name>/` and implement `Workflow` from `src/workflows/types.ts`. Every API call goes through the `Session` in `src/kit/record.ts`, which applies the run's budget, sends `max_pages` on every list call and keeps each response.

## Release

1. Set the version in `package.json` and `src/version.ts`, and date its entry in `CHANGELOG.md`: `## 0.1.0 (DD/MM/YYYY)`.
2. Run `npm run release:check` with `SOCIALCRAWL_LEAK_GATE` set to the leak gate. It runs the gate, the whole suite and the build, and checks the version, the changelog entry and the files the package would publish.
3. `git tag v0.1.0 && git push origin v0.1.0`. The release workflow publishes to npm with provenance (it needs the `NPM_TOKEN` repository secret) and creates the GitHub release from the changelog entry.

## Licence

MIT. Methods adapted from other MIT projects are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The SocialCrawl name and logo (`assets/`, `docs/`) are not covered by the MIT licence.

Help: socialcrawl@ridio.io
