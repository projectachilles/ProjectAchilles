---
sidebar_position: 4
title: "Agent Admin Endpoints"
description: "REST API endpoints for agent administration — list agents, create tokens, manage tasks and schedules."
---

# Agent Admin Endpoints

## Endpoints

All endpoints require **Clerk JWT** authentication.

### List Agents

```
GET /api/agent/admin/agents
```

Returns all enrolled agents with status, system info, and tags.

### Create Enrollment Token

```
POST /api/agent/admin/tokens
```

**Body:**
```json
{
  "ttl_hours": 24,
  "max_uses": 10,
  "description": "Lab deployment batch"
}
```

### Create Task

```
POST /api/agent/admin/tasks
```

**Body:**
```json
{
  "agent_ids": ["agent-uuid-1", "agent-uuid-2"],
  "test_uuid": "test-uuid",
  "platform": "windows",
  "arch": "amd64",
  "es_index": "achilles-results-engagement1"
}
```

### List Schedules

```
GET /api/agent/admin/schedules
```

### Create Schedule

```
POST /api/agent/admin/schedules
```

**Body:**
```json
{
  "test_uuid": "test-uuid",
  "frequency": "daily",
  "time": "09:00",
  "agent_ids": ["agent-uuid"],
  "platform": "windows",
  "arch": "amd64",
  "randomize": true
}
```
