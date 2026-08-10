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
2. Classify discovered templates by type and declared purpose, then choose the matching web, Markdown, or permitted blank route
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

# Markdown templates (optional; inspect the HTTP status)
gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE

# For each Markdown template, fetch its exact discovered path
DISCOVERED_TEMPLATE_PATH="<path-returned-by-discovery>"
gh api "repos/{owner}/{repo}/contents/$DISCOVERED_TEMPLATE_PATH" --jq '.content' | base64 -d

# Blank-issue policy (optional; inspect the HTTP status)
gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE/config.yml
```

- Classify each candidate's delivery type as `form/YAML`, `Markdown`, or `other` from its discovered representation.
- Read each discovered template's declared metadata before selection. For form/YAML templates, use the metadata returned by `issue_templates` discovery. For every Markdown template, fetch the exact discovered path and inspect its frontmatter metadata, including fields such as `name` and `about`.
- Classify each candidate's purpose as `bug`, `feature`, or `other` from declared metadata; never classify purpose or select from a guessed filename.
- Route a confirmed matching form/YAML candidate through `gh issue create --web` so its controls remain in the discovered web chooser. Never pass a form/YAML identifier to `--template`.
- Assign `TEMPLATE_ID` only from a confirmed matching Markdown candidate, then use `gh issue create --template "$TEMPLATE_ID"`.
- Treat other candidate types as no routable template match; never pass them to `--template`.
- If no candidate matches, use the documented blank-issue path only when blank issues are allowed; otherwise stop for maintainer guidance.
- Both `.github/ISSUE_TEMPLATE` and `.github/ISSUE_TEMPLATE/config.yml` are optional lookups. For either lookup, HTTP 404 means "not configured"; continue to the blank-issue fallback policy.
- Any non-404 failure (including authentication, authorization, rate-limit, network, 5xx, malformed, or unknown failures) is blocking: surface the failure and stop. Never suppress it.
- On HTTP 200 for `config.yml`, decode the response body's `.content` field from base64 before reading the policy.
- Read `.github/ISSUE_TEMPLATE/config.yml` when it exists and honor its `blank_issues_enabled` flag: when `blank_issues_enabled: false`, do not create a blank issue — use a discovered template that fits, or stop and request maintainer guidance when no template fits.
- When the `config.yml` lookup returns HTTP 404 or `blank_issues_enabled` is true/unset, fall back gracefully when templates are absent. Many repos (including gentle-pi) ship **no** `.github/ISSUE_TEMPLATE/` directory; in that case create a blank issue with the sections below as a guide, not a hard template.
- The template examples in this skill only apply when the discovered repo actually exposes those templates. Do not pass a guessed filename.

### Discover labels

```bash
gh api --paginate 'repos/{owner}/{repo}/labels?per_page=100' --jq '.[].name'
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

- Apply only labels that exist in the discovered label set returned by complete paginated discovery.
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
| Unix home paths (`/home/<username>/...`, `/Users/<username>/...`) | `<home-path>/...` |
| Windows home paths (`C:\Users\<username>\...`) | `<home-path>\...` |
| Non-home absolute paths | Preserve the generic root and replace private components with established placeholders, for example `/var/lib/<private-project>/...` |
| Credentials, API keys, tokens | `<credential>` |
| Internal endpoints / URLs | `<internal-endpoint>` |

Rules:
- Never publish raw argv, absolute paths, or environment values.
- Scrub log output even when it appears inside a code block.
- Scrub error messages that echo a private path or hostname.
- When in doubt, scrub. A redacted issue can be amended later; a leaked credential cannot be un-leaked.

Safe path scrub examples:

- `/home/<username>/work/<private-project>` → `<home-path>/work/<private-project>`
- `/Users/<username>/work/<private-project>` → `<home-path>/work/<private-project>`
- `C:\Users\<username>\work\<private-project>` → `<home-path>\work\<private-project>`
- For a non-home absolute path, preserve only its generic root and replace private segments, for example `/var/lib/<private-project>/...`.

---

## Issue Templates

The templates below are **examples**. They only apply when the discovered repo exposes those exact templates. When the repo has no `.github/ISSUE_TEMPLATE/` directory (gentle-pi does not), create a blank issue using the field lists as a guide, not as enforced form fields.

### Form/YAML Issue Forms

When declared metadata confirms a matching form/YAML candidate, preserve its controls by opening the discovered web chooser. Do not assign `TEMPLATE_ID` or pass `--template` for an issue form.

```bash
gh issue create --web
```

Stop for human completion in the web form.

### Bug Report (example Markdown template)

Markdown template identifier (when present): select it only after declared metadata classifies it as a bug match.
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

#### Example — Bug Report via CLI (confirmed Markdown only)

```bash
# Assign only after declared metadata confirms a matching Markdown bug candidate.
TEMPLATE_ID="<confirmed-matching-markdown-template-identifier>"
gh issue create --template "$TEMPLATE_ID" --title "fix(scripts): setup.sh fails on zsh with glob error"
```

---

### Feature Request (example Markdown template)

Markdown template identifier (when present): select it only after declared metadata classifies it as a feature match.
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

#### Example — Feature Request via CLI (confirmed Markdown only)

```bash
# Assign only after declared metadata confirms a matching Markdown feature candidate.
TEMPLATE_ID="<confirmed-matching-markdown-template-identifier>"
gh issue create --template "$TEMPLATE_ID" --title "feat(scripts): add Codex support to setup.sh"
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

- Is it a bug? → After question and duplicate checks, route a confirmed form/YAML match to the web chooser, a confirmed Markdown match to `--template`, or use a permitted blank issue with bug fields.
- Is it a new feature/improvement? → After question and duplicate checks, route a confirmed form/YAML match to the web chooser, a confirmed Markdown match to `--template`, or use a permitted blank issue with feature fields.
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

# Markdown templates (optional; inspect the HTTP status)
gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE

# For each Markdown template, fetch its exact discovered path
DISCOVERED_TEMPLATE_PATH="<path-returned-by-discovery>"
gh api "repos/{owner}/{repo}/contents/$DISCOVERED_TEMPLATE_PATH" --jq '.content' | base64 -d

# Blank-issue policy (optional; inspect the HTTP status)
gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE/config.yml

# Labels (discovered set)
gh api --paginate 'repos/{owner}/{repo}/labels?per_page=100' --jq '.[].name'
```

Both `.github/ISSUE_TEMPLATE` and `.github/ISSUE_TEMPLATE/config.yml` are optional lookups. For either lookup, HTTP 404 means "not configured"; continue to the blank-issue fallback policy. Any non-404 failure (including authentication, authorization, rate-limit, network, 5xx, malformed, or unknown failures) is blocking: surface the failure and stop. Never suppress it. On HTTP 200 for `config.yml`, decode the response body's `.content` field from base64 before reading the policy.

Before selection, classify candidate type as `form/YAML`, `Markdown`, or `other`, and inspect declared purpose metadata as `bug`, `feature`, or `other`. Use form/YAML metadata returned by `issue_templates`; fetch each discovered Markdown path and inspect frontmatter such as `name` and `about`. Route a confirmed form/YAML match through the web chooser, assign `TEMPLATE_ID` only from a confirmed Markdown match, and never route other types through `--template`. If none matches, use the blank-issue path only when allowed; otherwise stop for maintainer guidance.

### Duplicate search (open AND closed)

```bash
gh issue list --state all --limit 1000 --search "keywords"
```

### Create

```bash
# Confirmed matching form/YAML candidate: open the web chooser; never use --template.
gh issue create --web

# Confirmed matching Markdown candidate: assign its identifier for CLI template use.
TEMPLATE_ID="<confirmed-matching-markdown-template-identifier>"

# Markdown bug report (only when the selected template matches)
gh issue create --template "$TEMPLATE_ID" --title "fix(scope): description"

# Markdown feature request (only when the selected template matches)
gh issue create --template "$TEMPLATE_ID" --title "feat(scope): description"

# Other type or no confirmed metadata match: CLI body only when blank_issues_enabled allows it
gh issue create --title "fix(scope): description" --body "..."
# Otherwise stop for maintainer guidance.
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
Is it a question?                → Discussions, only when has_discussions = true
Is it a duplicate (open/closed)?  → Add occurrence comment to existing issue
Purpose metadata matches issue?  → Continue by candidate type
Confirmed candidate type = form/YAML? → Open the discovered web chooser
Confirmed candidate type = Markdown? → Use confirmed TEMPLATE_ID with --template
Other type or no confirmed match? → Blank only when allowed; otherwise stop for maintainer guidance
```
