# Changelog

Changes to the `socialcrawl` package. Dates are DD/MM/YYYY. A release is published by pushing its tag; see "Release" in the README.

## 0.1.2 (27/11/2026)

- `socialcrawl init` installs the workflows with `npx skills add socialcrawl/workflows` for the agents it finds, so `npx skills update` keeps them current and each install counts on the skill's page at skills.sh. If that command fails, or a `socialcrawl-<task>` skill from somewhere else is already there, it downloads the workflows and copies them itself, as before.
- The README says what that installer sends to skills.sh, and that `DO_NOT_TRACK=1` stops it.

## 0.1.1 (27/11/2026)

- `socialcrawl init` never replaces a skill it did not install. A skill of the same name from somewhere else, such as the SocialCrawl API skill (`socialcrawl`, from socialcrawl/skills), is left as it was and named in the output.
- Every workflow skill is named `socialcrawl-<task>`: `socialcrawl-workflows` (the router), `socialcrawl-viral`, `socialcrawl-pulse`, `socialcrawl-presence`, `socialcrawl-teardown`, `socialcrawl-video-teardown`, `socialcrawl-reddit-marketing`, `socialcrawl-x-marketing`, `socialcrawl-tiktok-marketing`, `socialcrawl-instagram-marketing`, `socialcrawl-youtube-marketing`, `socialcrawl-linkedin-marketing`, `socialcrawl-competitor-research` and `socialcrawl-post-tracker`. The CLI commands keep their names.
- `init` removes the folders 0.1.0 installed under the old names, only when 0.1.0 put them there. If that included the `socialcrawl` router, it prints how to get the API skill back.

## 0.1.0 (27/11/2026)

- `socialcrawl init`: saves your key outside any project after a free check, or signs you in by email, then installs the workflows into Claude Code, Cursor, Codex, Gemini CLI and GitHub Copilot.
- `socialcrawl whoami`: the key in use and its credits.
- `socialcrawl <workflow> "<input>"`: prints the price, runs inside the budget and your balance, and writes the run folder (`report.html`, `report.md`, `card.svg`, `data/*.csv`, `responses.jsonl`, `evidence.json`, `run.json`).
- `socialcrawl <workflow> --help`: the workflow's usage, examples, its own options and what a run may spend.
- Workflows: `social-viral`, `social-pulse`, `social-presence`, `linkedin-marketing`, `tiktok-marketing`, `instagram-marketing`, `youtube-marketing`, `x-marketing`, `competitor-research`, `post-tracker`, `video-teardown`, `social-teardown`, `reddit-marketing`.
