import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';
import endpointAuthReducer from './endpointAuthSlice';
import sensorsReducer from './sensorsSlice';

export const store = configureStore({
  reducer: {
    endpointAuth: endpointAuthReducer,
    sensors: sensorsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
