---
sidebar_position: 1
title: "OAuth Providers"
description: "Configure Google, GitHub, and Microsoft OAuth providers for ProjectAchilles authentication via Clerk."
---

# OAuth Providers

ProjectAchilles uses [Clerk](https://clerk.com) for authentication, supporting multiple OAuth providers out of the box.

## Supported Providers

| Provider | Development | Production |
|----------|:-----------:|:----------:|
| **Google** | Shared credentials (automatic) | Custom OAuth app required |
| **GitHub** | Shared credentials (automatic) | Custom OAuth app required |
| **Microsoft** | Shared credentials (automatic) | Custom OAuth app required |

## Development Mode

In Clerk development mode (`pk_test_` keys), social login works immediately with Clerk's shared OAuth credentials. No configuration needed.

## Production Mode

:::danger Custom Credentials Required
Clerk production instances (`pk_live_` keys) require your own OAuth app credentials for each provider. Without them, social login buttons redirect with an empty `client_id`, resulting in a 404 error.
:::

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://clerk.<your-domain>/v1/oauth_callback`
4. Enter Client ID and Client Secret in Clerk Dashboard → SSO Connections → Google

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) → OAuth Apps → New OAuth App
2. Set **Authorization callback URL** to `https://clerk.<your-domain>/v1/oauth_callback`
3. Generate a Client Secret
4. Enter Client ID and Client Secret in Clerk Dashboard → SSO Connections → GitHub

### Microsoft OAuth Setup

1. Go to [Azure Portal](https://portal.azure.com) → App Registrations → New Registration
2. Add redirect URI: `https://clerk.<your-domain>/v1/oauth_callback`
3. Create a client secret under Certificates & Secrets
4. Enter Application (client) ID and secret in Clerk Dashboard → SSO Connections → Microsoft

## Clerk Dashboard Configuration

After configuring OAuth providers:

1. Go to **Domains** → add your frontend URL as an allowed origin
2. Go to **Redirect URLs** → add `https://<your-domain>/*`
3. Ensure the correct environment (Development vs Production) is selected

## Troubleshooting

### Social login returns 404

You're using production keys without custom OAuth credentials. See the production setup steps above.

### "Clerk: auth() was called without middleware"

The backend middleware isn't configured. Ensure `@clerk/express` middleware is applied to the Express app.
