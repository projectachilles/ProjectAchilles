import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { endpointsApi } from '../services/api';

interface Organization {
  id: string;
  name: string;
  oid: string;
}

interface EndpointAuthState {
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  organizations: Organization[];
  currentOrg: Organization | null;
}

const initialState: EndpointAuthState = {
  isAuthenticated: false,
  loading: true, // Start with loading true to check session on mount
  error: null,
  organizations: [],
  currentOrg: null,
};

// Async thunks
export const login = createAsyncThunk(
  'endpointAuth/login',
  async (credentials: { oid: string; apiKey: string }, { rejectWithValue }) => {
    try {
      const response = await endpointsApi.login(credentials);
      return response;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Login failed');
    }
  }
);

export const logout = createAsyncThunk(
  'endpointAuth/logout',
  async (_, { rejectWithValue }) => {
    try {
      await endpointsApi.logout();
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Logout failed');
    }
  }
);

export const checkSession = createAsyncThunk(
  'endpointAuth/checkSession',
  async (_, { rejectWithValue }) => {
    try {
      const response = await endpointsApi.getSession();
      return response;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Session check failed');
    }
  }
);

export const switchOrganization = createAsyncThunk(
  'endpointAuth/switchOrganization',
  async (oid: string, { rejectWithValue }) => {
    try {
      const response = await endpointsApi.switchOrg(oid);
      return response;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Failed to switch organization');
    }
  }
);

const endpointAuthSlice = createSlice({
  name: 'endpointAuth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setCurrentOrg: (state, action: PayloadAction<Organization>) => {
      state.currentOrg = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Login
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.organizations = action.payload.data?.organizations || [];
        state.currentOrg = action.payload.data?.currentOrg || null;
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.error = action.payload as string;
      });

    // Logout
    builder
      .addCase(logout.pending, (state) => {
        state.loading = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.organizations = [];
        state.currentOrg = null;
        state.error = null;
      })
      .addCase(logout.rejected, (state) => {
        // Even if logout fails, clear local state
        state.loading = false;
        state.isAuthenticated = false;
        state.organizations = [];
        state.currentOrg = null;
      });

    // Check Session
    builder
      .addCase(checkSession.pending, (state) => {
        state.loading = true;
      })
      .addCase(checkSession.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = action.payload.data?.authenticated || false;
        state.organizations = action.payload.data?.organizations || [];
        state.currentOrg = action.payload.data?.currentOrg || null;
      })
      .addCase(checkSession.rejected, (state) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.organizations = [];
        state.currentOrg = null;
      });

    // Switch Organization
    builder
      .addCase(switchOrganization.pending, (state) => {
        state.loading = true;
      })
      .addCase(switchOrganization.fulfilled, (state, action) => {
        state.loading = false;
        state.currentOrg = action.payload.data?.currentOrg || state.currentOrg;
      })
      .addCase(switchOrganization.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearError, setCurrentOrg } = endpointAuthSlice.actions;
export default endpointAuthSlice.reducer;
