# socialcrawl

The SocialCrawl command line. You sign in once, it installs the SocialCrawl workflows into your coding agents, and each workflow runs from a terminal or from the agent:

```bash
npx -y socialcrawl@latest init
socialcrawl social-viral "AI coding tools"
```

Status, 27/11/2026: the engine and the API kit are in, with their tests. `init`, the report writer and the first workflow, `social-viral`, are being built here now. The npm package is not published yet.

## What a run gives you

A folder, `./socialcrawl-runs/<workflow>-<topic>-<date>/`, with:

- `report.html`: one page that works offline, with charts, each number linked to the response it came from
- `report.md`: the same as text
- `card.svg`: a 1200 × 675 card to share
- `data/*.csv`: every row read
- `responses.jsonl`: every raw API response, with its request id
- `evidence.json` and `run.json`: what each claim rests on, and what the run cost

Every run quotes its cost first, for free. A default run fits inside the 100 credits a new account starts with.

## Develop

Node 20 or later.

```bash
npm install
npm test          # tsc --strict, then node --test
npm run build     # dist/cli.js
```

Workflows live in `src/workflows/<name>/` and implement `Workflow` from `src/workflows/types.ts`. Every API call goes through the `Session` in `src/kit/record.ts`, which applies the run's budget, sends `max_pages` on every list call and keeps each response.

## Licence

MIT. Methods adapted from other MIT projects are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Help: socialcrawl@ridio.io
