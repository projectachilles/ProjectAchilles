---
sidebar_position: 8
title: "Configuration & Profiles"
description: "Multi-profile configuration, AI provider settings, and defaults."
---

# Configuration & Profiles

The CLI uses a profile-based configuration system that lets you manage multiple deployment environments (local, staging, production) with separate server URLs and authentication states.

## Config File Locations

All configuration is stored in the `~/.achilles/` directory:

| File | Description |
|------|-------------|
| `~/.achilles/config.json` | Main configuration (profiles, AI settings, defaults) |
| `~/.achilles/auth.json` | Auth tokens for the `default` profile |
| `~/.achilles/auth-{name}.json` | Auth tokens for named profiles |
| `~/.achilles/history` | Command history |

All files are created with **`0700`** (directory) or **`0600`** (files) permissions for security.

## Config Commands

```bash
achilles config <subcommand>
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | Show all configuration values |
| `get` | Get a specific config value |
| `set` | Set a config value |
| `profiles` | List all profiles |
| `add-profile` | Add a named deployment profile |
| `remove-profile` | Remove a profile |
| `use` | Switch active profile |

## Viewing Configuration

```bash
# Show all config values
achilles config list

# Get a specific value (dot notation)
achilles config get server_url
achilles config get ai.provider
achilles config get defaults.page_size
```

## Setting Values

```bash
achilles config set <key> <value>
```

Use dot notation to set nested values:

```bash
# Set the server URL for the active profile
achilles config set server_url https://app.projectachilles.io

# Set default output format
achilles config set defaults.output json

# Set default page size
achilles config set defaults.page_size 100
```

### Available Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `server_url` | string | `http://localhost:3000` | Backend API URL (active profile) |
| `defaults.output` | string | `pretty` | Default output format (`pretty` or `json`) |
| `defaults.page_size` | number | `50` | Default pagination size |
| `ai.provider` | string | `anthropic` | AI provider for chat mode |
| `ai.model` | string | (per provider) | AI model name |
| `ai.api_key` | string | | AI provider API key |
| `ai.base_url` | string | | Custom API base URL (for Ollama) |

---

## Profile Management

Profiles let you switch between different ProjectAchilles deployments without reconfiguring. Each profile has its own server URL and authentication tokens.

### Listing Profiles

```bash
achilles config profiles
```

```
      Profile         Server URL                                  Label
  ──  ──────────────  ────────────────────────────────────────    ──────────────
  ▸   default         http://localhost:3000                       Local
      railway         https://achilles-backend.up.railway.app     Railway
      fly             https://prod.agent.projectachilles.io        Production
```

The arrow (`▸`) indicates the active profile.

### Adding a Profile

```bash
achilles config add-profile <name> --url <server-url> [--label <label>]
```

**Examples:**

```bash
# Add a Railway deployment
achilles config add-profile railway \
  --url https://achilles-backend.up.railway.app \
  --label "Railway Staging"

# Add a Fly.io production deployment
achilles config add-profile fly \
  --url https://prod.agent.projectachilles.io \
  --label "Production"

# Add a Render deployment
achilles config add-profile render \
  --url https://achilles-backend.onrender.com \
  --label "Render"
```

### Switching Profiles

```bash
achilles config use <name>
```

**Example:**

```bash
achilles config use fly
```

```
  ✓ Switched to "fly" → https://prod.agent.projectachilles.io
  ⚠ Run `achilles login` to authenticate with this deployment
```

:::warning
After switching profiles, you need to run `achilles login` to authenticate with the new server. Each profile maintains separate auth tokens.
:::

### Removing a Profile

```bash
achilles config remove-profile <name>
```

The `default` profile cannot be removed. If you remove the currently active profile, the CLI automatically switches back to `default`.

---

## AI Provider Configuration

The chat agent requires an AI provider to be configured. Three providers are supported:

| Provider | Default Model | API Key Env Var |
|----------|--------------|-----------------|
| **Anthropic** | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `gpt-4o` | `OPENAI_API_KEY` |
| **Ollama** | `llama3` | (none needed) |

### Configuration Priority

The AI provider resolves settings in this order:

1. **CLI config** (`~/.achilles/config.json` -- `ai.*` keys)
2. **Environment variables** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
3. **Defaults** (Anthropic with `claude-sonnet-4-6`)

### Setting Up Anthropic (Default)

```bash
# Option 1: Set in config
achilles config set ai.provider anthropic
achilles config set ai.api_key sk-ant-api03-...

# Option 2: Use environment variable
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Setting Up OpenAI

```bash
achilles config set ai.provider openai
achilles config set ai.api_key sk-...
achilles config set ai.model gpt-4o
```

### Setting Up Ollama (Local Models)

[Ollama](https://ollama.ai/) runs models locally, so no API key is needed:

```bash
achilles config set ai.provider ollama
achilles config set ai.model llama3
achilles config set ai.base_url http://localhost:11434/v1
```

:::tip
Ollama uses the OpenAI-compatible API, so the CLI creates an OpenAI provider instance pointed at your local Ollama server.
:::

### Verifying AI Configuration

When you launch `achilles chat`, the chat interface displays the active model in the status bar. If no API key is configured, you will see a warning:

```
  ⚠ No AI provider configured.
    Set one with: achilles config set ai.provider anthropic
    And:          achilles config set ai.api_key sk-ant-...
```

---

## Config File Format

The `~/.achilles/config.json` file structure:

```json
{
  "active_profile": "default",
  "profiles": {
    "default": {
      "server_url": "http://localhost:3000",
      "label": "Local"
    },
    "fly": {
      "server_url": "https://prod.agent.projectachilles.io",
      "label": "Production"
    }
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "api_key": "sk-ant-api03-..."
  },
  "defaults": {
    "output": "pretty",
    "page_size": 50
  }
}
```

:::info Legacy Migration
If you have an older config file with a top-level `server_url` instead of `profiles`, the CLI automatically migrates it to the profile-based format on first load.
:::

---

## Typical Setup Workflow

```bash
# 1. Configure your deployment profiles
achilles config add-profile staging \
  --url https://staging.projectachilles.io \
  --label "Staging"

achilles config add-profile production \
  --url https://prod.agent.projectachilles.io \
  --label "Production"

# 2. Configure AI for chat mode
achilles config set ai.provider anthropic
achilles config set ai.api_key sk-ant-api03-...

# 3. Switch to staging and authenticate
achilles config use staging
achilles login

# 4. Verify everything works
achilles status

# 5. Switch to production when ready
achilles config use production
achilles login
```
