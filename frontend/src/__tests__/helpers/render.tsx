import { render } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import agentReducer from '@/store/agentSlice';
import type { RootState } from '@/store';

const rootReducer = combineReducers({ agent: agentReducer });

interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  preloadedState?: Partial<RootState>;
  route?: string;
}

/**
 * Render a component with Redux Provider and MemoryRouter.
 * Optionally supply preloadedState for the store and an initial route.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  {
    preloadedState,
    route = '/',
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState,
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>
          {children}
        </MemoryRouter>
      </Provider>
    );
  }

  return {
    store,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
