# Email Authentication Setup Guide

**Project:** ProjectAchilles
**Auth Provider:** Clerk
**Date:** 2025-12-13

---

## Overview

This guide enables email/password authentication alongside existing social OAuth providers (Google, Microsoft, GitHub).

**Benefits:**
- Users can sign up without social accounts
- More privacy-conscious option
- Works in restricted networks where social media is blocked
- Traditional authentication fallback

---

## Setup Instructions

### Step 1: Enable Email Authentication in Clerk

1. **Access Clerk Dashboard**
   ```
   URL: https://dashboard.clerk.com
   Select: "Project Achilles" application
   ```

2. **Navigate to Email Settings**
   ```
   Left Sidebar → Configure → Email, Phone, Username
   ```

3. **Enable Email Address**
   - Toggle **"Email address"** to **ON**
   - Configure options:
     ```
     ✓ Required for sign-up: ON
     ✓ Used for sign-in: ON
     ✓ Verification method: Verification code (recommended)
     ```

4. **Enable Password**
   - Toggle **"Password"** to **ON**
   - Configure password requirements:
     ```
     ✓ Minimum length: 8 characters
     ✓ Require lowercase letter: ON
     ✓ Require uppercase letter: ON
     ✓ Require number: ON
     ✓ Require special character: ON (optional but recommended)
     ```

5. **Configure Email Verification**
   - Choose verification method:
     - **Verification code** (default) - User receives 6-digit code
     - **Verification link** - User clicks link in email
   - Set verification code expiration: 10 minutes (default)

6. **Save Changes**
   - Click **"Save"** or **"Apply changes"**
   - Changes take effect immediately

---

## Email Provider Configuration (Optional)

By default, Clerk uses their built-in email service. For production, you may want to use your own:

### Option 1: Use Clerk's Email Service (Default)
- ✅ Already configured
- ✅ No setup required
- ✅ Works immediately
- ⚠️ Emails come from Clerk domain
- ⚠️ Limited customization

### Option 2: Custom Email Provider (Advanced)

**Supported Providers:**
- SendGrid
- Mailgun
- AWS SES
- Postmark
- Resend

**Setup:**
1. Go to **Configure** → **Email & SMS**
2. Click **"Email"** tab
3. Click **"Add email service"**
4. Select provider and follow instructions
5. Verify DNS records (SPF, DKIM)

**Recommended for Production:**
- Custom domain emails (e.g., noreply@projectachilles.io)
- Better deliverability
- Professional appearance

---

## Testing Email Authentication

### Test Sign-Up Flow

1. **Start Development Server**
   ```bash
   ./scripts/start.sh
   ```

2. **Open Application**
   ```
   http://localhost:5173
   ```

3. **Navigate to Sign-Up**
   - Click **"Sign up"** link
   - You should see:
     ```
     ✓ Email address field
     ✓ Password field
     ✓ Continue with Google
     ✓ Continue with Microsoft
     ✓ Continue with GitHub
     ```

4. **Create Test Account**
   ```
   Email: test@example.com
   Password: TestPassword123!
   ```

5. **Verify Email**
   - Check email inbox for verification code
   - Enter 6-digit code
   - Should complete sign-up

6. **Verify Dashboard Access**
   - Should redirect to main app
   - Should be authenticated
   - User button should show in header

### Test Sign-In Flow

1. **Sign Out**
   - Click user button → Sign out

2. **Navigate to Sign-In**
   - Should redirect to sign-in page
   - Should see email/password fields

3. **Sign In with Email**
   ```
   Email: test@example.com
   Password: TestPassword123!
   ```

4. **Verify Success**
   - Should authenticate successfully
   - Should redirect to app
   - Should access all modules

### Test Password Reset (Important!)

1. **Go to Sign-In Page**

2. **Click "Forgot password?"**

3. **Enter Email Address**
   ```
   Email: test@example.com
   ```

4. **Check Email**
   - Should receive password reset code or link

5. **Reset Password**
   - Enter new password
   - Confirm change

6. **Sign In with New Password**
   - Verify reset worked

---

## Email Templates Customization (Optional)

### Available Templates

Clerk sends emails for:
1. **Verification** - Email verification code
2. **Invitation** - Invite users to organization
3. **Magic Link** - Passwordless sign-in (if enabled)
4. **Password Reset** - Password recovery

### Customize Templates

1. **Access Email Templates**
   ```
   Clerk Dashboard → Configure → Email & SMS → Email Templates
   ```

2. **Edit Templates**
   - Click on template to edit
   - Use Liquid template syntax
   - Preview before saving

3. **Available Variables**
   ```liquid
   {{application_name}}
   {{user_first_name}}
   {{verification_url}}
   {{verification_code}}
   ```

4. **Example Custom Template**
   ```liquid
   Hi {{user_first_name}},

   Welcome to {{application_name}}!

   Your verification code is: {{verification_code}}

   This code expires in 10 minutes.

   Best regards,
   ProjectAchilles Team
   ```

---

## Security Best Practices

### Password Requirements

**Current Configuration:**
- ✅ Minimum 8 characters
- ✅ Uppercase + lowercase
- ✅ Numbers required
- ✅ Special characters (optional but recommended)

**Recommended for Production:**
```
Minimum length: 12 characters
Require all character types: Yes
Password strength meter: Enable
Password breach detection: Enable (Clerk Pro)
```

### Email Verification

**Why It's Important:**
- Prevents fake accounts
- Ensures user owns email
- Enables password recovery
- Required for security compliance

**Recommended Settings:**
```
Verification required: Yes
Verification method: Code (more secure than link)
Code expiration: 10 minutes
Max verification attempts: 3
```

### Rate Limiting

Clerk automatically implements rate limiting for:
- Sign-up attempts
- Sign-in attempts
- Password reset requests
- Verification code requests

**Default Limits:**
- 10 attempts per IP per hour
- 5 verification codes per email per hour

---

## Production Considerations

### Before Production Deployment

- [ ] Email verification enabled
- [ ] Strong password requirements configured
- [ ] Email templates customized (optional)
- [ ] Custom email provider configured (recommended)
- [ ] SPF/DKIM records verified (if custom provider)
- [ ] Test password reset flow
- [ ] Test email deliverability
- [ ] Configure email rate limits
- [ ] Review Clerk security settings

### Email Deliverability

**To avoid spam filters:**
1. Use custom email provider (SendGrid, Mailgun)
2. Configure SPF records
3. Configure DKIM signing
4. Use proper from address (noreply@projectachilles.io)
5. Warm up email domain gradually
6. Monitor bounce rates

### Monitoring

**Watch for:**
- Email bounce rates
- Failed verification attempts
- Password reset abuse
- Spam sign-ups

**Clerk Dashboard Metrics:**
- Go to **Analytics** to view:
  - Sign-up conversion rates
  - Email verification rates
  - Authentication method breakdown

---

## User Experience

### Sign-Up Page Layout

With all providers enabled, users will see:

```
┌─────────────────────────────────────┐
│     ProjectAchilles Sign Up          │
├─────────────────────────────────────┤
│                                      │
│  Email address                       │
│  [                    ]              │
│                                      │
│  Password                            │
│  [                    ]              │
│                                      │
│  [       Sign Up       ]             │
│                                      │
│  ──────── or ────────                │
│                                      │
│  [ Continue with Google    ]         │
│  [ Continue with Microsoft ]         │
│  [ Continue with GitHub    ]         │
│                                      │
│  Already have an account? Sign in    │
└─────────────────────────────────────┘
```

### Sign-In Page Layout

```
┌─────────────────────────────────────┐
│     ProjectAchilles Sign In          │
├─────────────────────────────────────┤
│                                      │
│  Email address or username           │
│  [                    ]              │
│                                      │
│  Password                            │
│  [                    ]              │
│                                      │
│  Forgot password?                    │
│                                      │
│  [       Sign In       ]             │
│                                      │
│  ──────── or ────────                │
│                                      │
│  [ Continue with Google    ]         │
│  [ Continue with Microsoft ]         │
│  [ Continue with GitHub    ]         │
│                                      │
│  Don't have an account? Sign up      │
└─────────────────────────────────────┘
```

---

## Troubleshooting

### Issue: Email not received

**Check:**
1. Spam/junk folder
2. Email address is correct
3. Clerk email service is working (check status page)
4. Rate limits not exceeded

**Solution:**
1. Try different email provider (Gmail, Outlook)
2. Whitelist Clerk's email domain
3. Request new verification code
4. Check Clerk Dashboard → Logs for errors

### Issue: Verification code expired

**Check:**
- Code is 6 digits
- Entered within 10 minutes
- Not reusing old code

**Solution:**
1. Request new verification code
2. Check email immediately
3. Use code within time limit

### Issue: Password doesn't meet requirements

**Check password requirements:**
- At least 8 characters
- Contains uppercase letter
- Contains lowercase letter
- Contains number
- Contains special character (if required)

**Solution:**
- Use password like: `SecurePass123!`
- Enable password strength indicator

### Issue: "Email already exists"

**Cause:** Email already registered

**Solution:**
1. Use "Sign In" instead of "Sign Up"
2. Use "Forgot password" if password unknown
3. Sign in with social provider linked to that email

---

## Code Changes (None Required!)

**Good news:** No code changes needed!

Your existing implementation already supports email authentication:

```tsx
// frontend/src/pages/auth/SignInPage.tsx
<SignIn
  routing="path"
  path="/sign-in"
  signUpUrl="/sign-up"
  afterSignInUrl="/"
/>
```

Clerk's `<SignIn>` component automatically:
- ✅ Detects enabled auth methods
- ✅ Shows email/password fields
- ✅ Handles email verification
- ✅ Manages password reset
- ✅ Displays social providers
- ✅ Handles all validation

Same for `<SignUp>` component!

---

## Additional Features (Optional)

### Magic Link Authentication

Enable passwordless authentication:

1. **Clerk Dashboard**
   ```
   Configure → Email, Phone, Username
   ```

2. **Enable Magic Link**
   ```
   Email link sign-in: ON
   ```

3. **User Experience**
   - User enters email
   - Receives link to sign in
   - No password needed
   - More secure than passwords

### Multi-Factor Authentication (MFA)

Add extra security layer:

1. **Clerk Dashboard**
   ```
   Configure → Multi-factor
   ```

2. **Enable Options**
   ```
   ✓ SMS verification
   ✓ Authenticator app (TOTP)
   ✓ Backup codes
   ```

3. **User Setup**
   - Users enable MFA in profile
   - Scan QR code with authenticator app
   - Save backup codes

---

## Testing Checklist

Before considering complete:

- [ ] Email sign-up works
- [ ] Email verification received and works
- [ ] Email sign-in works
- [ ] Password reset works
- [ ] Social OAuth still works (Google, Microsoft, GitHub)
- [ ] All authentication methods visible on sign-in page
- [ ] Password requirements enforced
- [ ] Email format validated
- [ ] Error messages clear and helpful
- [ ] Redirects work after authentication
- [ ] User can sign out
- [ ] User can sign back in with email

---

## Documentation Updates

Update these files for production deployment:

1. **deployment/PRODUCTION_DEPLOYMENT.md**
   - Add email authentication to testing section
   - Update OAuth configuration notes

2. **README.md**
   - List email as authentication method
   - Update features section

---

## Support Resources

- **Clerk Email Docs:** https://clerk.com/docs/authentication/configuration/email-options
- **Password Settings:** https://clerk.com/docs/authentication/configuration/password-settings
- **Email Templates:** https://clerk.com/docs/authentication/email-sms-templates

---

## Summary

**What You Get:**
- ✅ Email/password authentication
- ✅ Automatic email verification
- ✅ Password reset flow
- ✅ No code changes required
- ✅ Works alongside social OAuth
- ✅ Secure password requirements
- ✅ Professional email templates

**Time to Enable:** 5-10 minutes
**Code Changes:** None required
**Testing Time:** 10-15 minutes

**Next Steps:**
1. Enable email authentication in Clerk Dashboard (now)
2. Test sign-up flow with email
3. Test sign-in flow with email
4. Verify all methods work together
5. Deploy to production (already configured)
