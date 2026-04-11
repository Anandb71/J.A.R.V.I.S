# Contributing to J.A.R.V.I.S.

Thanks for your interest in contributing.

## Development setup

1. Run `scripts/setup.ps1`
2. Run `scripts/dev.ps1`
3. Run tests before opening PR:
   - `npm test`
   - `.\.venv\Scripts\python -m pytest backend/tests -q`

## Branch and commit style

- Create focused branches (`feat/...`, `fix/...`, `docs/...`)
- Keep commits small and descriptive
- Use Conventional Commit style when possible (`feat:`, `fix:`, `docs:`)

## Pull request expectations

- Include clear summary and motivation
- Link related issue(s)
- Add screenshots/GIFs for UI changes
- Add/update tests for behavior changes
- Keep security/privacy implications explicit for tool, voice, and vision code

## Code quality guidelines

- Prefer small, testable functions
- Avoid unrelated refactors in the same PR
- Preserve existing public interfaces unless migration is documented
- Validate Electron IPC security constraints when touching `electron/`

## Reporting issues

Please use the issue templates and include:

- Repro steps
- Expected vs actual behavior
- Logs and environment info

Thanks for helping make this repo public-ready and production-minded.
