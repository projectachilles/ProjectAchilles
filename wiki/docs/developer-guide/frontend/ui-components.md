---
sidebar_position: 4
title: "UI Components"
description: "Shared UI component primitives in ProjectAchilles — Button, Card, Input, Badge, and more."
---

# UI Components

## Component Library

UI primitives live in `frontend/src/components/shared/ui/`:

| Component | Purpose |
|-----------|---------|
| `Button` | Primary action buttons with variants |
| `Card` | Content container with optional header/footer |
| `Input` | Text input with label and error state |
| `Badge` | Status indicators and labels |
| `Tabs` | Tab navigation component |
| `Alert` | Informational/warning/error alerts |
| `Spinner` | Loading indicator |

## Usage

```typescript
import { Button } from '@/components/shared/ui/Button';
import { Card } from '@/components/shared/ui/Card';
import { Badge } from '@/components/shared/ui/Badge';

<Card>
  <Badge variant="success">Protected</Badge>
  <Button onClick={handleRun}>Execute Test</Button>
</Card>
```

## Theming

All components respect the active visual theme (Default, Neobrutalism, Hacker Terminal) via CSS variables defined in Tailwind CSS v4 `@theme` blocks.
