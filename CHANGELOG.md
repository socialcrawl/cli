# Changelog

Changes to the `socialcrawl` package. Dates are DD/MM/YYYY. A release is published by pushing its tag; see "Release" in the README.

## 0.1.0 (unreleased)

- `socialcrawl init`: saves your key outside any project after a free check, or signs you in by email, then installs the workflows into Claude Code, Cursor, Codex, Gemini CLI and GitHub Copilot.
- `socialcrawl whoami`: the key in use and its credits.
- `socialcrawl <workflow> "<input>"`: prints the price, runs inside the budget and your balance, and writes the run folder (`report.html`, `report.md`, `card.svg`, `data/*.csv`, `responses.jsonl`, `evidence.json`, `run.json`).
- `socialcrawl <workflow> --help`: the workflow's usage, examples, its own options and what a run may spend.
- Workflows: `social-viral`, `social-pulse`, `social-presence`, `linkedin-marketing`, `tiktok-marketing`, `instagram-marketing`, `youtube-marketing`, `x-marketing`, `competitor-research`, `post-tracker`.
