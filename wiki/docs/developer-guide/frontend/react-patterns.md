---
sidebar_position: 1
title: "React Patterns"
description: "React patterns used in the ProjectAchilles frontend — functional components, hooks, and authentication."
---

# React Patterns

## Component Patterns

### Functional Components with Hooks

All components use functional components with hooks. No class components.

```typescript
interface SecurityTestCardProps {
  test: SecurityTest;
  onFavorite: (uuid: string) => void;
}

export function SecurityTestCard({ test, onFavorite }: SecurityTestCardProps) {
  // Component implementation
}
```

### Path Alias

Use `@/` for imports within `frontend/src/`:

```typescript
import { Button } from '@/components/shared/ui/Button';
import { useAuthenticatedApi } from '@/hooks/useAuthenticatedApi';
```

### Import Ordering

Group imports: external libraries first, then internal modules:

```typescript
// External
import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';

// Internal
import { Button } from '@/components/shared/ui/Button';
import { fetchTests } from '@/services/api/browser';
```

### Authentication Wrapping

All authenticated routes use the `<RequireAuth>` wrapper component, which redirects to Clerk sign-in if the user is not authenticated.
