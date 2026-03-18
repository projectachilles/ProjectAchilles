---
sidebar_position: 5
title: "Custom Tests"
description: "Add custom security tests to ProjectAchilles using the hybrid test library system with collision-free UUIDs."
---

# Custom Tests

ProjectAchilles supports a hybrid test library that combines upstream tests (from a Git repository) with custom tests you create.

## How It Works

The test indexer scans multiple sources and merges them into a unified library:

1. **Upstream source** — Tests from the configured Git repository (`TESTS_REPO_URL`), automatically synced
2. **Custom source** — Tests in a local `custom_tests/` directory

Both sources are indexed with collision-free UUIDs, so custom tests never conflict with upstream tests.

## Creating a Custom Test

### Directory Structure

Each test lives in its own directory under `custom_tests/`:

```
custom_tests/
└── my-custom-test/
    ├── main.go           # Test source code
    ├── README.md         # Test documentation
    ├── metadata.json     # Test metadata (technique, severity, etc.)
    └── detection/        # Optional detection rules
        ├── rule.kql      # KQL detection rule
        └── rule.yara     # YARA detection rule
```

### Metadata Format

```json
{
  "name": "My Custom Test",
  "description": "Description of what this test does",
  "category": "defense-evasion",
  "severity": "high",
  "platforms": ["windows", "linux"],
  "techniques": ["T1059.001"],
  "tactics": ["execution", "defense-evasion"],
  "author": "Your Name"
}
```

## Auto-Bootstrap

When the backend starts and finds no test library, it auto-bootstraps by cloning the upstream repository. Custom tests are indexed on top of the upstream library.

## Collision-Free UUIDs

Each test is assigned a UUID based on its source and directory name. Upstream and custom tests use different UUID namespaces, so they never collide even if they have the same directory name.
