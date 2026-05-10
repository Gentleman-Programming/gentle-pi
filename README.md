# Gentle Pi

Gentle Pi it's a Pi coding-agent fork tuned for controlled autonomy: SDD planning, native subagents, Engram memory, strict TDD, and a senior-architect persona.

It is not a generic Gentle AI runtime. It is Gentle AI made-to-measure for this Pi agent.

## Quick start

```bash
npm install
npm run build
node packages/coding-agent/dist/cli.js --mcp-config .pi/mcp.json
```

## One-command setup

For the MVP flow, clone this repo and run the setup script:

```bash
bash scripts/setup-gentle-pi.sh
```

The script:

- installs workspace dependencies,
- builds all packages,
- creates a local `pi` wrapper for `pi-subagents`,
- warms Pi package resolution from `.pi/settings.json`,
- detects your shell,
- installs a `gentle-pi` alias/function for bash, zsh, or fish,
- launches Gentle Pi automatically.

To set everything up without launching at the end:

```bash
GENTLE_PI_SKIP_LAUNCH=1 bash scripts/setup-gentle-pi.sh
```

If subagents report `spawn pi ENOENT`, make sure a `pi` executable is on `PATH`. The setup script creates this wrapper automatically:

```bash
mkdir -p ~/.pi/agent/bin
cat > ~/.pi/agent/bin/pi <<'EOF'
#!/usr/bin/env bash
exec node "/Users/alanbuscaglia/work/gentle-pi/packages/coding-agent/dist/cli.js" "$@"
EOF
chmod +x ~/.pi/agent/bin/pi
```

## Shell aliases

Use an alias so you do not have to pass the MCP config every time.

The setup script installs this automatically. Manual setup is only needed if you do not run the script.

### zsh / bash

Add this to `~/.zshrc` or `~/.bashrc`:

```bash
alias gentle-pi='PATH="$HOME/.pi/agent/bin:$PATH" node "/Users/alanbuscaglia/work/gentle-pi/packages/coding-agent/dist/cli.js" --mcp-config "/Users/alanbuscaglia/work/gentle-pi/.pi/mcp.json"'
```

### fish

Add this to `~/.config/fish/config.fish`:

```fish
function gentle-pi
    env PATH="$HOME/.pi/agent/bin:$PATH" node "/Users/alanbuscaglia/work/gentle-pi/packages/coding-agent/dist/cli.js" --mcp-config "/Users/alanbuscaglia/work/gentle-pi/.pi/mcp.json" $argv
end
```

Then ask:

```text
quién sos?
tenés Engram?
podés delegar en subagentes?
```

## What this fork adds

| Harness | What it does |
|---------|--------------|
| Gentle identity | Makes the agent answer as Gentle Pi: direct, technical, Rioplatense in Spanish, senior-architect oriented. |
| SDD runtime | Uses OpenSpec artifacts for proposal, specs, design, tasks, apply progress, verify reports, and archive flow. |
| Native subagents | Uses `pi-subagents` project agents and chains for SDD phases, reviewers, workers, and orchestration. |
| Engram bridge | Connects Engram through Pi MCP adapter using `.pi/mcp.json`; falls back truthfully when unavailable. |
| Safety policy | Blocks destructive shell/git/npm paths and checkpoints mutating execution where the Gentle Pi phase requires it. |
| Review guard | Forecasts review workload and records delivery strategy/size exception decisions. |

## Installed Pi packages

Gentle Pi loads these project packages from `.pi/settings.json`:

- `pi-subagents` — native delegation, chains, parallel reviewers, workers, and SDD phase agents.
- `pi-intercom` — supervisor/child coordination for blocked decisions and progress updates.
- `pi-mcp-adapter` — MCP bridge for Engram and future external tools.
- `@juicesharp/rpiv-ask-user-question` — structured clarification questions when the agent should not guess.

Engram is configured in `.pi/mcp.json`:

```json
{
	"mcpServers": {
		"engram": {
			"command": "/Users/alanbuscaglia/.local/bin/engram",
			"args": ["mcp", "--tools=agent"],
			"lifecycle": "lazy",
			"directTools": true
		}
	}
}
```

## SDD workflow

Planning artifacts live under `openspec/changes/`.

Current completed changes:

- `gentle-pi-agent` — core harness runtime, safety policy, routing, TDD evidence, review guard.
- `gentle-pi-identity-memory` — persona, self-description, subagent SDD assets, memory protocol.
- `gentle-pi-engram-bridge` — typed Engram bridge detection, tool mapping, and truthful memory states.

Project subagent assets live under:

- `.pi/agents/`
- `.pi/chains/`

## Verification

Use the repo gates after changes:

```bash
npm run build
npm run check
npm --prefix packages/coding-agent run test
```

For focused Gentle Pi regressions:

```bash
npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts
```

## Notes

- `auth.json` is intentionally ignored locally and must not be committed.
- `.pi/mcp.json` is machine-specific because it points to the local Engram binary.
- Pi memory extensions were evaluated as references only. Engram remains the primary memory target.

## License

MIT
