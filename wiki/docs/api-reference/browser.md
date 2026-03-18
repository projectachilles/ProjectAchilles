---
sidebar_position: 2
title: "Browser Endpoints"
description: "REST API endpoints for the ProjectAchilles test browser — list tests, get details, and retrieve files."
---

# Browser Endpoints

## Endpoints

### List Tests

```
GET /api/browser/tests
```

Returns all security tests from the indexed test library.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "uuid": "a1b2c3d4-...",
      "name": "Process Injection via CreateRemoteThread",
      "category": "defense-evasion",
      "severity": "high",
      "platforms": ["windows"],
      "techniques": ["T1055.001"],
      "tactics": ["defense-evasion", "privilege-escalation"]
    }
  ]
}
```

### Get Test Details

```
GET /api/browser/tests/:uuid
```

Returns full metadata for a specific test including description, author, version history, and MITRE mappings.

### List Test Files

```
GET /api/browser/tests/:uuid/files
```

Returns the list of files in a test directory (source, docs, detection rules, references).

### Get File Contents

```
GET /api/browser/tests/:uuid/files/:filename
```

Returns the raw contents of a specific test file.
