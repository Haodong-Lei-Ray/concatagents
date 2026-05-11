# Hermes Agent Guide

> Official docs: https://hermes-agent.nousresearch.com/docs/
> GitHub: https://github.com/NousResearch/hermes-agent
> Version: v0.13.0 (2026-05-07)

---

## Install

```bash
# Official install script (recommended)
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh

# Or via pip/uv
pip install hermes-cli
uv tool install hermes-cli
```

Install path: `~/.hermes/hermes-agent/`  
Binary: `~/.local/bin/hermes`

---

## Basic Usage

### Launch modes

```bash
# Interactive TUI (recommended)
hermes

# One-shot prompt
hermes -z "your question"

# Specify model
hermes -m deepseek-v4-pro --provider custom

# Specify provider
hermes --provider custom

# YOLO mode (auto-approve all tool calls)
hermes --yolo

# Continue last session
hermes --continue

# Resume specific session
hermes --resume <session-id>

# Force TUI
hermes --tui
```

### Config

```bash
# Show config
hermes config show

# Edit config
hermes config edit

# Set a value
hermes config set model.default deepseek-v4-pro

# Config paths
hermes config path        # -> ~/.hermes/config.yaml
hermes config env-path    # -> ~/.hermes/.env (API keys)
```

---

## Skills

### Search and install

```bash
# Search skills
hermes skills search <keyword>
hermes skills search comfyui --source clawhub

# Browse available skills (paginated)
hermes skills browse

# Inspect skill (without installing)
hermes skills inspect <skill-id>

# Install skill
hermes skills install <skill-id>
hermes skills install openai/skills/skill-creator

# Install from URL
hermes skills install https://example.com/path/to/SKILL.md --name my-skill

# Skip confirmation
hermes skills install <skill-id> --yes
```

### Manage installed skills

```bash
hermes skills list
hermes skills check
hermes skills update
hermes skills config
hermes skills uninstall <skill-name>

# Custom GitHub taps
hermes skills tap add <github-user/repo>
hermes skills tap list
hermes skills tap remove <tap-name>
```

### Trigger skills

Use natural language in chat and Hermes auto-matches relevant skills, or pass skills explicitly:

```bash
hermes --skills ascii-art
hermes --skills "github-issues,codebase-inspection"
hermes -z "help me generate a diagram" --skills comfyui
```

---

## Queue and Non-Interrupt Workflow

When Hermes is busy, you can send follow-up instructions in 4 ways:

- Direct input: interrupts current task
- `/queue <msg>`: run after current task (recommended)
- `/bg <msg>` or `/btw <msg>`: run in background
- `/steer <msg>`: inject guidance after next tool step

### Useful control commands

```bash
/busy queue
/busy steer
/busy interrupt
/busy status
/agents
/stop
/approve
/deny
/retry
/undo
/rollback
/compress
```

---

## Model Management

```bash
hermes model
/model
hermes -m deepseek-v4-pro --provider custom
hermes -m claude-sonnet-4-6 --provider custom
hermes fallback --help
```

---

## Session Management

```bash
hermes sessions
/sessions
hermes --continue
hermes --resume <session-name-or-id>
/resume <name>
/title My Project Session
/branch
/new
```

---

## Cron Tasks

```bash
/cron list
/cron add
/cron pause <id>
/cron resume <id>
/cron remove <id>
/cron run <id>
```

---

## Update and Maintenance

```bash
hermes update
hermes doctor
hermes logs
hermes export
```

---

## Local Reference

| Item | Value |
|------|-------|
| Config | `~/.hermes/config.yaml` |
| API keys | `~/.hermes/.env` |
| Provider | `custom` |
| Base URL | `http://35.220.164.252:3888/v1` |
| Default model | `deepseek-v4-pro` |

When using `custom` provider, include `--provider custom` (or set it in config).

---

*Last updated: 2026-05-11*

