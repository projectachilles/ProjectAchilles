# Changelog Generator

Generate Keep a Changelog entries from conventional commits since the last release.

## Usage

Accepts an optional argument: `platform` or `agent`. If not provided, ask the user which version stream to generate for.

## Steps

### 1. Find the Last Tag

**Platform:**
```bash
git tag -l 'v*' --sort=-v:refname | head -1
```

**Agent:**
```bash
git tag -l 'agent-v*' --sort=-v:refname | head -1
```

If no tags exist, use the initial commit: `git rev-list --max-parents=0 HEAD`

### 2. Collect Commits

```bash
git log <tag>..HEAD --oneline --no-merges
```

### 3. Parse and Categorize

Map conventional commit types to Keep a Changelog sections:

| Commit prefix | Section | Notes |
|---------------|---------|-------|
| `feat(*)` | `### Added` | New features |
| `fix(*)` | `### Fixed` | Bug fixes |
| `perf(*)` | `### Changed` | Prefix with "Performance:" |
| `refactor(*)` | `### Changed` | Code improvements |
| `BREAKING` or `!` | `### Changed` | Prefix with **BREAKING:** |
| CVE or security mention | `### Security` | Security fixes |
| `docs(*)` | Skip | Unless `--include-docs` requested |
| `style(*)` | Skip | Formatting only |
| `test(*)` | Skip | Test changes |
| `chore(deps)` | Skip | Dependabot noise |
| `chore(*)` | Skip | Unless notable |

### 4. Group by Scope

Within each section, group entries by scope:

```markdown
### Added

#### Frontend
- Add dark mode toggle for settings page
- Add export button to analytics dashboard

#### Backend
- Add webhook retry logic for failed deliveries

### Fixed

#### Agent
- Fix heartbeat timeout on slow networks
```

If a commit has no scope, list it without a subheading.

### 5. Format Output

Use this template:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Description of feature (commit hash link)

### Changed
- Description of change

### Fixed
- Description of fix

### Security
- Description of security fix
```

For agent releases, use `## Agent [X.Y.Z] - YYYY-MM-DD`.

Only include sections that have entries. Use today's date.

### 6. Present and Offer to Write

Show the generated changelog to the user. Then ask:

> "Would you like me to insert this into `docs/CHANGELOG.md`?"

If yes:
- For platform: replace items in `[Unreleased]` with the new version section
- For agent: insert after `[Unreleased]` as a new `## Agent [X.Y.Z]` section
- Update comparison links at the bottom of the file
