---
sidebar_position: 2
title: "Email & Password"
description: "Enable email/password authentication in ProjectAchilles alongside OAuth providers."
---

# Email & Password

Email and password authentication is configured entirely through the Clerk Dashboard. Nothing changes in the ProjectAchilles deployment. For the full Clerk setup (keys, session token, access mode, first admin), see [Clerk Setup](../../deployment/clerk-setup).

## Quick Setup (5 Minutes)

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) → your application
2. Navigate to **Configure** → **User & authentication** (older Clerk dashboards call this page **Email, Phone, Username**)
3. Turn on **Email** as a sign-in option
4. Turn on **Password** as an authentication strategy
5. Click **Save**

Users can now sign in with email and password alongside OAuth providers.

:::info[Who can create an account]
That depends on Clerk's **Access mode**, not on this setting. With
**Invite-only** (the mode [Clerk Setup](../../deployment/clerk-setup#restrict-sign-ups)
recommends), a person needs an invitation, which an admin sends from
**Settings → Users** in ProjectAchilles. The invitation carries the role. An
account with no role is read-only (`explorer`).
:::

## Configuration Options

### Email Verification

By default, Clerk sends a verification email on sign-up. You can configure:
- **Required verification** — Users must verify email before accessing the app
- **Optional verification** — Users can access immediately, verify later

### Password Requirements

Configure the password policy in the Clerk Dashboard, in the password settings of **User & authentication**:
- Minimum length (default: 8 characters)
- Require uppercase, lowercase, numbers, or special characters
- Block common passwords

## Testing

1. Open `https://<your-domain>/sign-up` (with **Invite-only** access, open the link in the invitation email instead)
2. Enter an email address and password
3. Check your email for the verification code
4. Enter the code to complete registration
5. You are redirected to the Dashboard (`/dashboard`)

A new account has the role from its invitation. Without one it is read-only
until an admin sets a role under **Settings → Users**.

## Production Best Practices

- Enable email verification in production
- Set minimum password length to 12+ characters
- Enable "block common passwords"
- Set Clerk's access mode to **Invite-only**
- Consider enabling multi-factor authentication (MFA) for admin accounts. An admin can run commands on every enrolled endpoint
