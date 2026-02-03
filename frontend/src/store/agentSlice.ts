/**
 * Agent Redux Slice
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { agentApi } from '@/services/api/agent';
import type {
  AgentSummary,
  Agent,
  AgentTask,
  AgentMetrics,
  CreateTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
} from '@/types/agent';

interface AgentState {
  agents: AgentSummary[];
  selectedAgent: Agent | null;
  tasks: AgentTask[];
  metrics: AgentMetrics | null;
  loading: boolean;
  error: string | null;
  filters: ListAgentsRequest;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

const initialState: AgentState = {
  agents: [],
  selectedAgent: null,
  tasks: [],
  metrics: null,
  loading: false,
  error: null,
  filters: {
    limit: 50,
    offset: 0,
  },
  pagination: {
    page: 1,
    pageSize: 50,
    total: 0,
  },
};

function extractErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Async thunks
export const fetchAgents = createAsyncThunk(
  'agents/fetch',
  async (filters: ListAgentsRequest | undefined, { rejectWithValue }) => {
    try {
      return await agentApi.listAgents(filters);
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to fetch agents'));
    }
  }
);

export const fetchAgent = createAsyncThunk(
  'agents/fetchOne',
  async (id: string, { rejectWithValue }) => {
    try {
      return await agentApi.getAgent(id);
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to fetch agent'));
    }
  }
);

export const fetchMetrics = createAsyncThunk(
  'agents/fetchMetrics',
  async (_, { rejectWithValue }) => {
    try {
      return await agentApi.getMetrics();
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to fetch metrics'));
    }
  }
);

export const fetchTasks = createAsyncThunk(
  'agents/fetchTasks',
  async (filters: ListTasksRequest | undefined, { rejectWithValue }) => {
    try {
      return await agentApi.listTasks(filters);
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to fetch tasks'));
    }
  }
);

export const createTasks = createAsyncThunk(
  'agents/createTasks',
  async (data: CreateTasksRequest, { rejectWithValue }) => {
    try {
      return await agentApi.createTasks(data);
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to create tasks'));
    }
  }
);

export const updateAgentStatus = createAsyncThunk(
  'agents/updateStatus',
  async ({ id, status }: { id: string; status: Agent['status'] }, { rejectWithValue }) => {
    try {
      return await agentApi.updateAgent(id, { status });
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to update agent'));
    }
  }
);

export const tagAgent = createAsyncThunk(
  'agents/tag',
  async ({ id, tag }: { id: string; tag: string }, { rejectWithValue }) => {
    try {
      await agentApi.tagAgent(id, tag);
      return { id, tag };
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to tag agent'));
    }
  }
);

export const untagAgent = createAsyncThunk(
  'agents/untag',
  async ({ id, tag }: { id: string; tag: string }, { rejectWithValue }) => {
    try {
      await agentApi.untagAgent(id, tag);
      return { id, tag };
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error, 'Failed to untag agent'));
    }
  }
);

// Slice
const agentSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<Partial<ListAgentsRequest>>) => {
      state.filters = { ...state.filters, ...action.payload };
      state.filters.offset = 0;
      state.pagination.page = 1;
    },
    setPage: (state, action: PayloadAction<number>) => {
      const page = action.payload;
      state.pagination.page = page;
      state.filters.offset = (page - 1) * state.pagination.pageSize;
    },
    setPageSize: (state, action: PayloadAction<number>) => {
      const pageSize = action.payload;
      state.pagination.pageSize = pageSize;
      state.filters.limit = pageSize;
      state.pagination.page = 1;
      state.filters.offset = 0;
    },
    selectAgent: (state, action: PayloadAction<Agent | null>) => {
      state.selectedAgent = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    setAgents: (state, action: PayloadAction<AgentSummary[]>) => {
      state.agents = action.payload;
      state.pagination.total = action.payload.length;
    },
  },
  extraReducers: (builder) => {
    // Fetch agents
    builder.addCase(fetchAgents.pending, (state) => {
      state.loading = true;
      state.error = null;
    });
    builder.addCase(fetchAgents.fulfilled, (state, action) => {
      state.loading = false;
      state.agents = action.payload;
      state.pagination.total = action.payload.length;
    });
    builder.addCase(fetchAgents.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload as string;
    });

    // Fetch single agent
    builder.addCase(fetchAgent.fulfilled, (state, action) => {
      state.selectedAgent = action.payload;
    });

    // Fetch metrics
    builder.addCase(fetchMetrics.fulfilled, (state, action) => {
      state.metrics = action.payload;
    });

    // Fetch tasks
    builder.addCase(fetchTasks.fulfilled, (state, action) => {
      state.tasks = action.payload;
    });

    // Tag agent
    builder.addCase(tagAgent.fulfilled, (state, action) => {
      const { id, tag } = action.payload;
      const agent = state.agents.find((a) => a.id === id);
      if (agent && !agent.tags.includes(tag)) {
        agent.tags.push(tag);
      }
    });

    // Untag agent
    builder.addCase(untagAgent.fulfilled, (state, action) => {
      const { id, tag } = action.payload;
      const agent = state.agents.find((a) => a.id === id);
      if (agent) {
        agent.tags = agent.tags.filter((t) => t !== tag);
      }
    });
  },
});

export const { setFilters, setPage, setPageSize, selectAgent, clearError, setAgents } = agentSlice.actions;
export default agentSlice.reducer;
