# Development

See [AGENTS.md](../../../AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/earendil-works/pi-mono
cd pi-mono
npm install
npm run build
```

Run from source:

```bash
/path/to/pi-mono/pi-test.sh
```

The script can be run from any directory. Pi keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.pi/agent/pi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Gentle Pi Runtime Profile

Gentle Pi is the default profile for this private fork. It activates coding-agent runtime contracts around OpenSpec SDD artifacts, project standards, phase isolation, command policy, and rollback checkpoints. Set `PI_GENTLE_PI_DISABLED=1` only when you need to compare against the upstream-compatible runtime path.

### Policy Boundaries

| Boundary | Runtime behavior |
|----------|------------------|
| OpenSpec context | Phase setup requires `openspec/config.yaml` and resolves change artifacts before execution. |
| Standards injection | Compact Project Standards are available to isolated Gentle Pi phase runs via `PI_GENTLE_PI_PHASE`; non-phase sessions keep the normal prompt. |
| Command safety | Bash execution denies destructive git/removal commands and blocks forbidden project commands before spawn. |
| Rollback workflow | Mutating SDD phases can record checkpoint metadata under `openspec/changes/<change>/rollback-checkpoints/`. |

### Rollback Workflow

1. Create a checkpoint before state-mutating phase work.
2. Keep checkpoint metadata with the OpenSpec change.
3. Restore copied files from the checkpoint directory if a phase must be reverted.
4. Record the rollback in apply or verify output so the next phase sees the boundary.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
