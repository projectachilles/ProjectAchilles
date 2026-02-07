import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import agentReducer, {
  setFilters,
  setPage,
  setPageSize,
  selectAgent,
  clearError,
  setAgents,
} from '../agentSlice';

function createStore(preloaded?: any) {
  return configureStore({
    reducer: { agent: agentReducer },
    preloadedState: preloaded,
  });
}

describe('agentSlice reducers', () => {
  it('has correct initial state', () => {
    const store = createStore();
    const state = store.getState().agent;

    expect(state.agents).toEqual([]);
    expect(state.selectedAgent).toBeNull();
    expect(state.tasks).toEqual([]);
    expect(state.metrics).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.filters).toEqual({ limit: 50, offset: 0 });
    expect(state.pagination).toEqual({ page: 1, pageSize: 50, total: 0 });
  });

  describe('setFilters', () => {
    it('merges partial filters and resets pagination', () => {
      const store = createStore();

      store.dispatch(setFilters({ status: 'active', os: 'linux' }));
      const state = store.getState().agent;

      expect(state.filters.status).toBe('active');
      expect(state.filters.os).toBe('linux');
      expect(state.filters.offset).toBe(0);
      expect(state.pagination.page).toBe(1);
    });

    it('preserves existing filters when merging', () => {
      const store = createStore();

      store.dispatch(setFilters({ status: 'active' }));
      store.dispatch(setFilters({ os: 'linux' }));

      const state = store.getState().agent;
      expect(state.filters.status).toBe('active');
      expect(state.filters.os).toBe('linux');
    });
  });

  describe('setPage', () => {
    it('updates page and computes offset', () => {
      const store = createStore();

      store.dispatch(setPage(3));
      const state = store.getState().agent;

      expect(state.pagination.page).toBe(3);
      expect(state.filters.offset).toBe(100); // (3-1) * 50
    });

    it('handles page 1 with zero offset', () => {
      const store = createStore();

      store.dispatch(setPage(2));
      store.dispatch(setPage(1));
      const state = store.getState().agent;

      expect(state.pagination.page).toBe(1);
      expect(state.filters.offset).toBe(0);
    });
  });

  describe('setPageSize', () => {
    it('updates pageSize and resets to page 1', () => {
      const store = createStore();

      store.dispatch(setPage(3)); // Move to page 3 first
      store.dispatch(setPageSize(25));

      const state = store.getState().agent;
      expect(state.pagination.pageSize).toBe(25);
      expect(state.filters.limit).toBe(25);
      expect(state.pagination.page).toBe(1);
      expect(state.filters.offset).toBe(0);
    });
  });

  describe('selectAgent', () => {
    it('sets the selected agent', () => {
      const store = createStore();
      const agent = { id: 'agent-1', hostname: 'test' } as any;

      store.dispatch(selectAgent(agent));

      expect(store.getState().agent.selectedAgent).toEqual(agent);
    });

    it('clears the selected agent with null', () => {
      const store = createStore();

      store.dispatch(selectAgent({ id: 'agent-1' } as any));
      store.dispatch(selectAgent(null));

      expect(store.getState().agent.selectedAgent).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears any existing error', () => {
      const store = createStore({
        agent: {
          agents: [],
          selectedAgent: null,
          tasks: [],
          metrics: null,
          loading: false,
          error: 'Something went wrong',
          filters: { limit: 50, offset: 0 },
          pagination: { page: 1, pageSize: 50, total: 0 },
        },
      });

      store.dispatch(clearError());
      expect(store.getState().agent.error).toBeNull();
    });
  });

  describe('setAgents', () => {
    it('sets agents array and updates total', () => {
      const store = createStore();
      const agents = [
        { id: '1', hostname: 'host-1', tags: [] },
        { id: '2', hostname: 'host-2', tags: [] },
      ] as any[];

      store.dispatch(setAgents(agents));
      const state = store.getState().agent;

      expect(state.agents).toEqual(agents);
      expect(state.pagination.total).toBe(2);
    });
  });
});

describe('agentSlice async thunk state transitions', () => {
  it('sets loading on fetchAgents.pending', () => {
    const store = createStore();

    store.dispatch({ type: 'agents/fetch/pending' });
    const state = store.getState().agent;

    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('sets agents on fetchAgents.fulfilled', () => {
    const store = createStore();
    const agents = [{ id: '1', hostname: 'h1', tags: [] }];

    store.dispatch({ type: 'agents/fetch/fulfilled', payload: agents });
    const state = store.getState().agent;

    expect(state.loading).toBe(false);
    expect(state.agents).toEqual(agents);
    expect(state.pagination.total).toBe(1);
  });

  it('sets error on fetchAgents.rejected', () => {
    const store = createStore();

    store.dispatch({ type: 'agents/fetch/rejected', payload: 'Network error' });
    const state = store.getState().agent;

    expect(state.loading).toBe(false);
    expect(state.error).toBe('Network error');
  });

  it('adds tag on tagAgent.fulfilled', () => {
    const store = createStore({
      agent: {
        agents: [{ id: 'a1', hostname: 'h1', tags: ['existing'] }],
        selectedAgent: null,
        tasks: [],
        metrics: null,
        loading: false,
        error: null,
        filters: { limit: 50, offset: 0 },
        pagination: { page: 1, pageSize: 50, total: 1 },
      },
    });

    store.dispatch({
      type: 'agents/tag/fulfilled',
      payload: { id: 'a1', tag: 'new-tag' },
    });

    expect(store.getState().agent.agents[0].tags).toEqual(['existing', 'new-tag']);
  });

  it('does not duplicate existing tag', () => {
    const store = createStore({
      agent: {
        agents: [{ id: 'a1', hostname: 'h1', tags: ['existing'] }],
        selectedAgent: null,
        tasks: [],
        metrics: null,
        loading: false,
        error: null,
        filters: { limit: 50, offset: 0 },
        pagination: { page: 1, pageSize: 50, total: 1 },
      },
    });

    store.dispatch({
      type: 'agents/tag/fulfilled',
      payload: { id: 'a1', tag: 'existing' },
    });

    expect(store.getState().agent.agents[0].tags).toEqual(['existing']);
  });

  it('removes tag on untagAgent.fulfilled', () => {
    const store = createStore({
      agent: {
        agents: [{ id: 'a1', hostname: 'h1', tags: ['keep', 'remove'] }],
        selectedAgent: null,
        tasks: [],
        metrics: null,
        loading: false,
        error: null,
        filters: { limit: 50, offset: 0 },
        pagination: { page: 1, pageSize: 50, total: 1 },
      },
    });

    store.dispatch({
      type: 'agents/untag/fulfilled',
      payload: { id: 'a1', tag: 'remove' },
    });

    expect(store.getState().agent.agents[0].tags).toEqual(['keep']);
  });
});
