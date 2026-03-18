---
sidebar_position: 8
title: "Alerting Endpoints"
description: "REST API endpoints for configuring alert thresholds and notification channels."
---

# Alerting Endpoints

## Endpoints

### Get Alert Configuration

```
GET /api/integrations/alerts/config
```

Returns current alert thresholds and notification channel configuration.

### Save Alert Configuration

```
POST /api/integrations/alerts/config
```

**Body:**
```json
{
  "thresholds": {
    "relative_drop": 10,
    "absolute_floor": 50
  },
  "channels": {
    "slack": {
      "enabled": true,
      "webhook_url": "https://hooks.slack.com/services/..."
    },
    "email": {
      "enabled": true,
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "smtp_user": "alerts@example.com",
      "smtp_pass": "...",
      "recipients": ["team@example.com"]
    }
  }
}
```

Credentials are encrypted at rest with AES-256-GCM.
