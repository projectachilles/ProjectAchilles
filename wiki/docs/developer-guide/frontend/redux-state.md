---
sidebar_position: 2
title: "Redux State"
description: "Redux Toolkit state management patterns in ProjectAchilles — slices, typed hooks, and async thunks."
---

# Redux State

## Redux Toolkit Setup

State management uses Redux Toolkit with typed hooks.

### Typed Hooks

Always use the typed hooks instead of raw `useDispatch`/`useSelector`:

```typescript
// Correct
import { useAppDispatch, useAppSelector } from '@/store';

// Incorrect
import { useDispatch, useSelector } from 'react-redux';
```

### Slices

Each module has its own Redux slice:

```typescript
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

export const fetchTests = createAsyncThunk('browser/fetchTests', async (_, { getState }) => {
  // API call
});

const browserSlice = createSlice({
  name: 'browser',
  initialState,
  reducers: { /* sync reducers */ },
  extraReducers: (builder) => {
    builder.addCase(fetchTests.fulfilled, (state, action) => {
      state.tests = action.payload;
    });
  },
});
```
