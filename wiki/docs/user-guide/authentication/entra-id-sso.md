---
sidebar_position: 3
title: "Microsoft Entra ID SSO"
description: "Let people sign in to ProjectAchilles with their Microsoft Entra ID work accounts, through a Clerk enterprise SSO connection. No ProjectAchilles code or configuration changes."
---

# Microsoft Entra ID SSO

People can sign in to ProjectAchilles with their Microsoft Entra ID (formerly
Azure AD) work accounts. ProjectAchilles signs people in with
[Clerk](https://clerk.com), and Clerk can hand the sign-in to Entra ID through
an **enterprise SSO connection** (SAML). You set it up in the Clerk Dashboard
and the Microsoft Entra admin center. Nothing changes in the ProjectAchilles
deployment: no environment variables, no restart.

With the connection on:

- anyone whose email is on your domain is sent to Microsoft to sign in;
- Entra ID decides who gets in: your MFA and Conditional Access policies apply,
  and only people assigned to the application can sign in;
- ProjectAchilles still decides what each person can do, through its
  [roles](#roles).

:::info[Not the same as the Microsoft social login or the Azure integration]
- **Microsoft social login** ([OAuth Providers](./oauth-providers)) lets anyone
  with any Microsoft account sign in. It doesn't tie sign-in to your tenant.
- The **[Azure / Entra ID integration](../integrations/azure-entra-id)** gives
  security tests credentials for your tenant. It has nothing to do with who can
  sign in to ProjectAchilles.
:::

## Before you start

| You need | Notes |
|----------|-------|
| A working ProjectAchilles install | With Clerk set up as in [Clerk Setup](../../deployment/clerk-setup). |
| A Clerk plan that includes enterprise SSO | Clerk's guide lists a paid plan as a prerequisite for a Production instance; see [Clerk pricing](https://clerk.com/pricing). A Development instance lets you try a connection first. |
| **Email** on as a sign-in option in Clerk | Clerk matches people to the connection by email domain. |
| Someone who can create enterprise applications in your Entra tenant | Often a different person from the Clerk admin: steps 2 and 3 are theirs. |
| The email domain of the people who will sign in | For example `example.com`. Every person needs the **mail** attribute filled in Entra ID. |

:::warning[Try it where a mistake can't lock people out]
Once the connection is enabled, everyone on that email domain signs in through
Entra ID, including existing users. If the configuration is wrong, they can't
sign in at all. Set it up on a Development instance first, or enable it at a
quiet time. See also [Keep a way back in](#recovery).
:::

## 1. Create the connection in Clerk

1. In the Clerk Dashboard, open the **SSO connections** page
   (**Configure → User & authentication → SSO connections**).
2. Select **Add connection**, then **For specific domains or organizations**.
3. Under **SAML**, select **Microsoft Entra ID (Formerly AD)**.
4. **Domain:** the email domain of the people who will sign in. Leave
   **Organization** empty unless your install already uses Clerk Organizations.
5. **Name:** what people see on the sign-in form, for example your
   organisation's name.
6. Select **Add connection**. The connection is created disabled.
7. Under **Service Provider configuration**, copy these two values for the
   person doing the Entra side:
   - **Identifier (Entity ID)**
   - **Reply URL (Assertion Consumer Service URL)**

## 2. Create the enterprise application in Entra ID

In the Microsoft Entra admin center (or the Azure portal):

1. Open **Enterprise applications** and select **New application**, then
   **Create your own application**.
2. Enter a name (for example `ProjectAchilles`), select **Integrate any other
   application you don't find in the gallery (Non-gallery)**, then **Create**.
3. Select **Assign users and groups**, then **Add user/group**, pick the people
   or groups who may use ProjectAchilles, and select **Assign**.

   :::tip[This list is your access control]
   Only assigned people can sign in. Assign a group, and joining or leaving
   ProjectAchilles becomes a group membership change in Entra ID.
   :::

4. Under **Manage**, select **Single sign-on**, then **SAML**.
5. In **Basic SAML Configuration**, select **Edit**. Paste the two values from
   step 1 into **Identifier (Entity ID)** and **Reply URL (Assertion Consumer
   Service URL)**, then **Save**.
6. In **Attributes & Claims**, select **Edit** and check these claims:

   | Attribute | Required | Claim name | Source |
   |-----------|:--------:|------------|--------|
   | Email address | Yes | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
   | First name | No | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
   | Last name | No | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

7. In **SAML Certificates**, copy the **App Federation Metadata Url**.

## 3. Finish and enable the connection in Clerk

1. Back on the **SSO connections** page, select the connection.
2. Under **Identity Provider configuration**, paste the **App Federation
   Metadata Url** and select **Fetch & save**.
3. Turn on **Enable connection** at the top of the page and select **Save**.

## 4. Test it

1. Open ProjectAchilles in a private browser window.
2. On the sign-in page, enter the email of a person assigned in step 2. You are
   sent to Microsoft to sign in, then back to ProjectAchilles.
3. A new person arrives with no role, which is read-only. Give them a role as
   described next.

## Roles \{#roles}

Entra ID decides **who can sign in**. ProjectAchilles decides **what they can
do**, with the same four roles as always: `admin`, `operator`, `analyst` and
`explorer` (see [Clerk Setup](../../deployment/clerk-setup#first-admin)).

- **A person who signs in through Entra ID for the first time has no role.**
  They get `explorer`: they can read the dashboards and the test library and
  change nothing.
- **An admin gives them a role** in ProjectAchilles under **Settings → Users**.
- **People who already had an account** keep it and their role: Clerk links the
  Entra sign-in to the existing account with the same email.

:::info[Setting the role from Entra ID]
Clerk can copy a claim from the SAML sign-in into the user's public metadata,
which is where ProjectAchilles reads `role`
([Clerk: custom attribute mapping](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/custom-attribute-mapping)).
This has not been validated with ProjectAchilles yet. If you try it:

- the value must be exactly `admin`, `operator`, `analyst` or `explorer`;
  anything else is treated as no role;
- Clerk applies the mapping at every sign-in, so a role set in **Settings →
  Users** may be replaced by the value from Entra ID;
- whoever can edit the application's claims in Entra ID can then make
  ProjectAchilles admins, and an admin can run commands on every enrolled
  endpoint. Treat that Entra permission accordingly.
:::

### Sign-ups

Clerk lists enterprise connections as one of the ways people are added when the
access mode is **Invite-only** (the mode [Clerk Setup](../../deployment/clerk-setup#restrict-sign-ups)
recommends). So a person assigned to the Entra application can get a
ProjectAchilles account without an invitation, as a read-only `explorer`.
Check this on your own instance, and keep the Entra assignment list to the
people who should see your results.

## When someone leaves

1. **Remove them from the Entra application** (or disable their Entra account).
   They can't sign in again.
2. **Remove them in ProjectAchilles** under **Settings → Users**. A session
   that is already open can stay valid until it expires; removing the user
   ends it.
3. **Revoke the API keys they created.** API keys are separate credentials:
   they are not tied to the person's Entra account and keep working until
   revoked.

## Keep a way back in \{#recovery}

If the connection breaks (an expired SAML certificate, a changed claim, a
deleted enterprise application), nobody on the SSO domain can sign in. Two ways
to recover:

- **Disable the connection in Clerk.** On the **SSO connections** page, turn
  off **Enable connection**. People on the domain can then use the other
  sign-in options again. This needs access to the Clerk Dashboard, which has
  its own login.
- **Keep one admin on an address outside the SSO domain**, protected with MFA
  in Clerk. This is a standing account that bypasses Entra ID, so decide
  whether your organisation accepts that.

## What SSO does not change

- **Agents** authenticate with their own keys. They are not affected.
- **API keys** keep working as before.
- **The `achilles` CLI** signs in through the browser, so it follows the same
  Entra sign-in.
- **Clerk is still in the sign-in path.** Browsers must reach both Clerk and
  Microsoft. An install with no internet access can't use this.

:::info[On-premises Active Directory]
Accounts synced from Active Directory to Entra ID (Microsoft Entra Connect) work
as described here. For AD FS, Clerk supports custom SAML providers; see
[Clerk's enterprise connections guide](https://clerk.com/docs/authentication/enterprise-connections/overview).
Signing in against an identity provider directly, with no Clerk, is on the
[roadmap](../../community/roadmap#sign-in-without-clerk).
:::

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Entering the email shows the normal sign-in, not Microsoft | The connection is still disabled (step 3), or the email's domain is not the connection's **Domain**. Subdomains don't match unless you allow them on the connection. |
| Microsoft says the person is not assigned to the application | Add them, or a group they belong to, under **Assign users and groups** (step 2). |
| Sign-in fails after returning from Microsoft | Check **Attributes & Claims**: the email claim must use `user.mail`, and the person's **mail** attribute must not be empty. |
| Signed in, but every action fails with **Insufficient permissions** (403) | The person has no role yet. An admin sets one under **Settings → Users**. |
| Nobody on the domain can sign in | See [Keep a way back in](#recovery). |

Clerk's own guide, with its current screens:
[Add Microsoft Entra ID as a SAML connection](https://clerk.com/docs/authentication/enterprise-connections/saml/azure).
