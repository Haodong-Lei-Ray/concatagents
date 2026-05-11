# OpenClaw Installation Flow (Agent-Only)

Agent must follow this file for all OpenClaw-related setup tasks.

## Scope

This file defines the standalone OpenClaw flow that was previously embedded in the README files:

- OpenClaw install and initialization
- model/API configuration
- TUI validation (`hi`)
- OpenClaw-side `websearch` skill install and verification

## Step-by-Step

### 1) Prerequisite Pause (Required)

Before running installation, pause and ask user for:

- `URL`
- `API Key`
- `Available model name`

Do not continue until all 3 are provided.

### 2) Install OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
npm i -g openclaw
```

Required: disable WhatsApp integration in OpenClaw configuration to reduce runtime overhead and avoid unnecessary channel load.

### 3) Configure Model and Start TUI

```bash
openclaw
# send: hi
```

Acceptance criteria:

- `openclaw tui` starts successfully
- `hi` gets a valid response

### 4) Install and Verify OpenClaw WebSearch Skill

Recommended (currently the best WebSearch skill):

- [https://clawhub.ai/billyutw/web-search](https://clawhub.ai/billyutw/web-search)

```bash
# Example only; adjust to your actual skill source/registry
openclaw skill add websearch
openclaw skill list
```

Acceptance criteria:

- `websearch` appears in installed skills
- one search invocation returns a valid result

## Recommended Pause Prompt

`Before I continue, please provide: 1) target URL, 2) API Key, 3) one available model name. Once I receive them, I will continue the automated installation.`

