# Email Authentication - Quick Start

**Time Required:** 5 minutes
**Code Changes:** None!

---

## Step-by-Step Setup (Clerk Dashboard)

### 1. Access Clerk Dashboard

```
🌐 Go to: https://dashboard.clerk.com
📱 Select: "Project Achilles" application
```

---

### 2. Enable Email Authentication

**Navigation:**
```
Left Sidebar → Configure → Email, Phone, Username
```

**Enable Email Address:**
```
┌─────────────────────────────────────────┐
│ Email address                     [ON]  │  ← Toggle this ON
├─────────────────────────────────────────┤
│ ☐ Required for sign-up           [✓]   │  ← Check this
│ ☐ Used for sign-in              [✓]   │  ← Check this
│                                          │
│ Verification method:                    │
│ ○ Verification code              [●]   │  ← Select this
│ ○ Verification link                     │
└─────────────────────────────────────────┘
```

---

### 3. Enable Password

**Scroll down to Password section:**
```
┌─────────────────────────────────────────┐
│ Password                          [ON]  │  ← Toggle this ON
├─────────────────────────────────────────┤
│ Password requirements:                  │
│ ☐ Minimum length: [8] characters  [✓]  │
│ ☐ Require lowercase letter        [✓]  │
│ ☐ Require uppercase letter        [✓]  │
│ ☐ Require number                  [✓]  │
│ ☐ Require special character       [ ]  │  ← Optional
└─────────────────────────────────────────┘
```

---

### 4. Save Changes

```
Click [Save] or [Apply changes] button
```

---

## ✅ That's It!

**No code changes needed!** Your app now supports:
- ✉️ Email/password sign-up
- 🔐 Email/password sign-in
- 📧 Email verification
- 🔄 Password reset
- 🌐 Social OAuth (Google, Microsoft, GitHub)

---

## Test It Now

### 1. Start Dev Server

```bash
./start.sh
```

### 2. Visit App

```
http://localhost:5173
```

### 3. Click "Sign Up"

You should now see:
```
┌──────────────────────────────┐
│   Email address              │
│   [                    ]     │
│                              │
│   Password                   │
│   [                    ]     │
│                              │
│   [     Sign Up      ]       │
│                              │
│   ────── or ────────         │
│                              │
│   [ 🌐 Continue with Google    ] │
│   [ 🔷 Continue with Microsoft ] │
│   [ 😺 Continue with GitHub    ] │
└──────────────────────────────┘
```

### 4. Create Test Account

```
Email: test@example.com
Password: TestPass123!
```

### 5. Check Email

- Check your email inbox
- Find verification code (6 digits)
- Enter code in app
- ✅ You're signed up!

---

## Visual Checklist

```
Development Setup:
├─ [✓] Enabled email in Clerk Dashboard
├─ [✓] Enabled password in Clerk Dashboard
├─ [✓] Configured password requirements
├─ [✓] Saved changes
└─ [✓] Restarted dev server

Testing:
├─ [✓] Sign-up page shows email fields
├─ [✓] Can create account with email
├─ [✓] Received verification email
├─ [✓] Verification code works
├─ [✓] Can sign in with email
├─ [✓] Can sign out
└─ [✓] Can sign back in

Production Ready:
├─ [✓] Email auth enabled in Clerk
├─ [✓] Password requirements set
├─ [✓] Tested in development
└─ [✓] Ready for Railway deployment
```

---

## Troubleshooting

**Don't see email fields?**
→ Refresh page after enabling in Clerk
→ Clear browser cache
→ Restart dev server

**Email not received?**
→ Check spam folder
→ Use different email (Gmail recommended for testing)
→ Wait 1-2 minutes

**Password rejected?**
→ Must be 8+ characters
→ Must have uppercase + lowercase
→ Must have number
→ Try: `TestPassword123!`

---

## Next Steps

Once email auth is working:

1. ✅ Test in development (done above)
2. 📝 Update README.md (list email as auth method)
3. 🚀 Deploy to production (already configured!)
4. 🎉 Users can sign up with email or social

---

## Questions?

- Full guide: `docs/EMAIL_AUTH_SETUP.md`
- Clerk docs: https://clerk.com/docs/authentication/configuration/email-options
- Need help? Just ask!

---

**Remember:** This works immediately in production too! Once you deploy to Railway, email authentication will be available automatically.
