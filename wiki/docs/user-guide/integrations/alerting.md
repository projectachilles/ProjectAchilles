---
sidebar_position: 3
title: "Alerting (Slack & Email)"
description: "Configure threshold-based alerting for defense score changes via Slack and email notifications."
---

# Alerting (Slack & Email)

## Overview

The alerting service dispatches notifications when test results cross configured thresholds. Alerts are evaluated after each result ingestion.

## Channels

### Slack
Alerts are sent as Block Kit formatted messages via a Slack webhook URL.

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace
2. Navigate to **Settings** → **Integrations** → **Alerting** → **Slack**
3. Paste the webhook URL
4. Send a test message to verify

### Email
Alerts are sent via SMTP using Nodemailer.

1. Navigate to **Settings** → **Integrations** → **Alerting** → **Email**
2. Configure SMTP settings (host, port, username, password)
3. Add recipient email addresses
4. Send a test email to verify

## Thresholds

Configure two types of thresholds:

| Threshold | Description |
|-----------|-------------|
| **Relative drop** | Alert when Defense Score drops by X% from the previous period |
| **Absolute floor** | Alert when Defense Score falls below X% |

## Notification Bell

Recent alerts also appear in the in-app notification bell in the top navigation bar.
