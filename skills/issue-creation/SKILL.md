---
name: gentle-ai-issue-creation
description: "Create Gentle AI issues with issue-first checks. Trigger: creating GitHub issues, bug reports, or feature requests."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
---

## When to Use

Use this skill when:
- Creating a GitHub issue (bug report or feature request)
- Helping a contributor file an issue
- Triaging or approving issues as a maintainer

---

## Critical Rules

1. **Discover blank-issue policy before creating** — never assume blank issues are disabled or that a specific template exists; honor `blank_issues_enabled` from `.github/ISSUE_TEMPLATE/config.yml` when present
2. **Discover Discussions support** — never assume a Discussions URL; route questions to Discussions only when the repo's `has_discussions` flag is true
3. **Search BOTH open AND closed issues for duplicates** — never create a duplicate of an existing issue
4. **Apply only discovered, policy-permitted labels** — never invent or assume label names
5. **Privacy-scrub before public publication** — replace private identifiers with explicit placeholders before submitting any issue
6. **Maintainer approval workflow** — every issue needs `status:needs-review` on creation and `status:approved` from a maintainer before any PR can be opened (when those labels exist in the discovered label set)

---

## Workflow

```
0. Pre-publication Discovery (repo capabilities, templates, labels, Discussions)
1. Search existing open AND closed issues for duplicates
2. Choose the correct template (from discovered templates, or fall back to blank)
3. Fill in ALL required fields
4. Check pre-flight checkboxes
5. Privacy-scrub title and body before submission
6. Submit → issue gets discovered status labels automatically (when configured)
7. Wait for maintainer to add status:approved (when that label exists)
8. Only then open a PR linking this issue
```

---

## Pre-publication Discovery

Run these read-only checks before creating any issue. The discovered values drive every later step.

### Discover repo capabilities

```bash
gh api repos/{owner}/{repo} --jq '{allow_issues: .has_issues, has_discussions: .has_discussions, has_pages: .has_pages}'
```

- `has_issues` controls whether issues can be created at all.
- `has_discussions` controls whether questions route to Discussions.
- When `has_issues` is false, stop: this repo does not accept issues.

### Discover issue templates

```bash
# Form-based templates (YAML)
gh api repos/{owner}/{repo}/issue_templates

# Markdown templates
gh api repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE

# Blank-issue policy (config.yml), when present
gh api repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE/config.yml --jq '.content' | base64 -d
```

- Read `.github/ISSUE_TEMPLATE/config.yml` when it exists and honor its `blank_issues_enabled` flag: when `blank_issues_enabled: false`, do not create a blank issue — use a discovered template that fits, or stop and request maintainer guidance when no template fits.
- When `config.yml` is absent or `blank_issues_enabled` is true/unset, fall back gracefully when templates are absent. Many repos (including gentle-pi) ship **no** `.github/ISSUE_TEMPLATE/` directory; in that case create a blank issue with the sections below as a guide, not a hard template.
- The template examples in this skill only apply when the discovered repo actually exposes those templates. Do not pass `--template bug_report.yml` to a repo that does not define it.

### Discover labels

```bash
gh api repos/{owner}/{repo}/labels --jq '.[].name'
```

- Apply only labels that appear in this discovered set.
- Respect auto-labeling from templates when present.
- Respect maintainer-only labels (`status:approved`, `priority:*`, etc.) — a contributor never adds these.

### Discover Discussions routing

- Use the `has_discussions` flag from the repo capability check above.
- When `has_discussions` is true, route questions to the repo's Discussions tab.
- When `has_discussions` is false, note that the repo does not support Discussions and ask the user how to proceed.

---

## Duplicate Reuse

Before creating a new issue, search BOTH open and closed issues:

```bash
gh issue list --state all --limit 1000 --search "keywords from title and body"
```

- An equivalent issue may be open OR closed.
- If an equivalent issue exists, add an occurrence comment with the new evidence instead of creating a duplicate:

```bash
gh issue comment <existing-number> --body "Occurrence: <scrubbed description and evidence>"
```

- Never create a duplicate of an existing open or closed issue.
- "Equivalent" means the same root cause or the same requested behavior, not merely the same keyword.

---

## Label Policy

- Apply only labels that exist in the discovered label set (`gh api repos/{owner}/{repo}/labels`).
- Never invent or assume label names.
- Respect auto-labeling from templates when present (a template may apply `bug`, `enhancement`, etc.).
- Respect maintainer-only labels — `status:approved`, `priority:high`, `priority:medium`, `priority:low` are maintainer-applied when they exist.
- A contributor never adds `status:approved` to their own issue.
- When the repo has no labels at all, create the issue without labels and let the maintainer triage.

---

## Privacy Scrub

Before public publication, replace every private identifier with an explicit placeholder. Apply the scrub to: issue title, body, log output, command output, and error messages.

| Identifier | Placeholder |
|------------|-------------|
| Private project names | `<private-project>` |
| Usernames | `<username>` |
| Hostnames | `<hostname>` |
| Home paths (`/Users/xxx/...`, `/home/xxx/...`) | `<home-path>/...` |
| Credentials, API keys, tokens | `<credential>` |
| Internal endpoints / URLs | `<internal-endpoint>` |

Rules:
- Never publish raw argv, absolute paths, or environment values.
- Scrub log output even when it appears inside a code block.
- Scrub error messages that echo a private path or hostname.
- When in doubt, scrub. A redacted issue can be amended later; a leaked credential cannot be un-leaked.

Example scrub:

```
Raw:    /Users/alice/dev/secret-project/.env leaked token sk-1234 on internal-ci.example.com
Scrubbed: <home-path>/dev/<private-project>/.env leaked token <credential> on <internal-endpoint>
```

---

## Issue Templates

The templates below are **examples**. They only apply when the discovered repo exposes those exact templates. When the repo has no `.github/ISSUE_TEMPLATE/` directory (gentle-pi does not), create a blank issue using the field lists as a guide, not as enforced form fields.

### Bug Report (example template)

Template (when present): `.github/ISSUE_TEMPLATE/bug_report.yml`
Auto-labels (when the template applies them): `bug`, `status:needs-review`

#### Required Fields

| Field | Description |
|-------|-------------|
| **Pre-flight Checks** | Checkboxes: searched open AND closed issues + understands approval workflow |
| **Bug Description** | Clear description of the bug |
| **Steps to Reproduce** | Numbered steps to reproduce |
| **Expected Behavior** | What should have happened |
| **Actual Behavior** | What happened instead (include scrubbed errors/logs) |
| **Operating System** | Dropdown: macOS, Linux variants, Windows, WSL |
| **Agent / Client** | Dropdown: Claude Code, OpenCode, Gemini CLI, Cursor, Windsurf, Codex, Other |
| **Shell** | Dropdown: bash, zsh, fish, Other |

#### Optional Fields

| Field | Description |
|-------|-------------|
| **Relevant Logs** | Scrubbed log output (auto-formatted as code block) |
| **Additional Context** | Screenshots, workarounds, extra info |

#### Example — Bug Report via CLI (only when the template exists)

```bash
gh issue create --template "bug_report.yml" \
  --title "fix(scripts): setup.sh fails on zsh with glob error" \
  --body "
### Pre-flight Checks
- [x] I searched open AND closed issues and this is not a duplicate
- [x] I understand this issue needs status:approved before a PR can be opened

### Bug Description
Running setup.sh on zsh throws a glob error when no matching files exist.

### Steps to Reproduce
1. Clone the repo
2. Run \`./scripts/setup.sh\` in zsh
3. See error: \`zsh: no matches found: skills/*\`

### Expected Behavior
The script should handle missing glob matches gracefully.

### Actual Behavior
Script crashes with glob error.

### Operating System
macOS

### Agent / Client
Claude Code

### Shell
zsh

### Relevant Logs
\`\`\`
zsh: no matches found: skills/*
\`\`\`
"
```

---

### Feature Request (example template)

Template (when present): `.github/ISSUE_TEMPLATE/feature_request.yml`
Auto-labels (when the template applies them): `enhancement`, `status:needs-review`

#### Required Fields

| Field | Description |
|-------|-------------|
| **Pre-flight Checks** | Checkboxes: searched open AND closed issues + understands approval workflow |
| **Problem Description** | The pain point this feature solves |
| **Proposed Solution** | How it should work from the user's perspective |
| **Affected Area** | Dropdown: Scripts, Skills, Examples, Documentation, CI/Workflows, Other |

#### Optional Fields

| Field | Description |
|-------|-------------|
| **Alternatives Considered** | Other approaches or workarounds |
| **Additional Context** | Mockups, examples, references |

#### Example — Feature Request via CLI (only when the template exists)

```bash
gh issue create --template "feature_request.yml" \
  --title "feat(scripts): add Codex support to setup.sh" \
  --body "
### Pre-flight Checks
- [x] I searched open AND closed issues and this is not a duplicate
- [x] I understand this issue needs status:approved before a PR can be opened

### Problem Description
The setup script only configures Claude Code, Gemini CLI, and OpenCode. Codex users have to manually copy skills.

### Proposed Solution
Add a Codex option to setup.sh that links skills to the .codex/ directory.

Example:
\`\`\`bash
./scripts/setup.sh --agent codex
\`\`\`

### Affected Area
Scripts (setup, installation)

### Alternatives Considered
Manually symlinking, but that defeats the purpose of the setup script.
"
```

---

## Label System

### Applied Automatically on Issue Creation (when the template drives it)

| Template | Labels added (when configured) |
|----------|-------------|
| Bug Report | `bug`, `status:needs-review` |
| Feature Request | `enhancement`, `status:needs-review` |

### Applied by Maintainers (when those labels exist in the discovered set)

| Label | When to apply |
|-------|--------------|
| `status:approved` | Issue accepted for implementation — PRs can now be opened |
| `priority:high` | Critical bug or urgent feature |
| `priority:medium` | Important but not blocking |
| `priority:low` | Nice to have |

The labels above are **discovered patterns**, not assumptions. When a repo does not define them, do not add them.

---

## Maintainer Approval Workflow

```
1. New issue arrives with status:needs-review (when that label exists)
2. Review the issue — is it valid, clear, and in scope?
3. If YES → add status:approved label (when it exists)
4. If NO → comment with reason, close if needed
5. Contributor can now open a PR linking this issue
```

---

## Questions vs Issues

- Is it a bug? → Use Bug Report template (or blank issue with bug fields when no template exists)
- Is it a new feature/improvement? → Use Feature Request template (or blank issue with feature fields)
- Is it a question? → Route to Discussions **only when `has_discussions` is true** (discovered, not assumed). When Discussions is not enabled, note that the repo does not support it and ask the user how to proceed.
- Is it a duplicate? → Link to the existing open or closed issue and add an occurrence comment.

---

## Commands

### Discovery (run before creating any issue)

```bash
# Repo capabilities (blank-issue policy, Discussions support)
gh api repos/{owner}/{repo} --jq '{allow_issues: .has_issues, has_discussions: .has_discussions}'

# Issue templates
gh api repos/{owner}/{repo}/issue_templates

# Blank-issue policy (config.yml), when present
gh api repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE/config.yml --jq '.content' | base64 -d

# Labels (discovered set)
gh api repos/{owner}/{repo}/labels --jq '.[].name'
```

### Duplicate search (open AND closed)

```bash
gh issue list --state all --limit 1000 --search "keywords"
```

### Create

```bash
# Bug report (only when the template was discovered)
gh issue create --template "bug_report.yml" --title "fix(scope): description"

# Feature request (only when the template was discovered)
gh issue create --template "feature_request.yml" --title "feat(scope): description"

# Blank issue (when no templates exist)
gh issue create --title "fix(scope): description" --body "..."
```

Apply a label only after confirming an exact matching label exists in the discovered label set; when the template drives auto-labeling, no manual --label is needed.

### Maintainer actions (only when those labels exist)

```bash
# Approve an issue
gh issue edit <number> --add-label "status:approved"

# Add priority
gh issue edit <number> --add-label "priority:high"
```

---

## Decision Tree

```
Repo has_issues = false?          → Stop: repo does not accept issues
blank_issues_enabled = false?     → Use a discovered template, or stop for maintainer guidance
Is it a bug?                     → Bug Report template (or blank with bug fields)
Is it a new feature/improvement?  → Feature Request template (or blank with feature fields)
Is it a question?                → Discussions, only when has_discussions = true
Is it a duplicate (open/closed)?  → Add occurrence comment to existing issue
```