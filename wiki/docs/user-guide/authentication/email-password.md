---
sidebar_position: 2
title: "Email & Password"
description: "Enable email/password authentication in ProjectAchilles alongside OAuth providers."
---

# Email & Password

Email and password authentication is configured entirely through the Clerk Dashboard — no code changes required.

## Quick Setup (5 Minutes)

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) → your application
2. Navigate to **Configure** → **Email, Phone, Username**
3. Toggle **Email address** to enabled
4. Under **Authentication strategies**, enable **Password**
5. Click **Save**

Users can now sign up and sign in with email and password alongside OAuth providers.

## Configuration Options

### Email Verification

By default, Clerk sends a verification email on sign-up. You can configure:
- **Required verification** — Users must verify email before accessing the app
- **Optional verification** — Users can access immediately, verify later

### Password Requirements

Configure in Clerk Dashboard → **Security** → **Password**:
- Minimum length (default: 8 characters)
- Require uppercase, lowercase, numbers, or special characters
- Block common passwords

## Testing

1. Navigate to your ProjectAchilles instance
2. Click **Sign Up** on the Clerk login page
3. Enter an email address and password
4. Check your email for the verification code
5. Enter the code to complete registration
6. You should be redirected to the Test Browser

## Production Best Practices

- Enable email verification in production
- Set minimum password length to 12+ characters
- Enable "block common passwords"
- Consider enabling multi-factor authentication (MFA) for admin accounts
