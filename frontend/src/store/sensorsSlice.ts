/**
 * Sensors Redux Slice
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../services/api/endpoints';
import type { Sensor, ListSensorsRequest } from '../types/endpoints';

/**
 * Maximum limit for fetching all sensors.
 * This is a safety limit to prevent excessive memory usage.
 * If your organization has more sensors, consider implementing pagination
 * or server-side "get all IDs" endpoint.
 */
const MAX_FETCH_ALL_LIMIT = 10000;

interface SensorsState {
  sensors: Sensor[];
  selectedSensor: Sensor | null;
  loading: boolean;
  error: string | null;
  filters: ListSensorsRequest;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

const initialState: SensorsState = {
  sensors: [],
  selectedSensor: null,
  loading: false,
  error: null,
  filters: {
    onlyOnline: false,
    withTags: true, // Always fetch tags with sensors
    limit: 50, // Default page size
    offset: 0,
  },
  pagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    hasMore: false,
  },
};

// Async thunks
export const fetchSensors = createAsyncThunk(
  'sensors/fetch',
  async (filters: ListSensorsRequest | undefined, { rejectWithValue }) => {
    try {
      const response = await api.listSensors(filters);
      if (response.success && response.data) {
        return {
          sensors: response.data.sensors,
          total: response.data.total || response.data.count || response.data.sensors.length,
          page: filters?.offset ? Math.floor(filters.offset / (filters.limit || 50)) + 1 : 1,
          pageSize: filters?.limit || 50,
        };
      }
      return rejectWithValue(response.error || 'Failed to fetch sensors');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch sensors');
    }
  }
);

export const tagSensor = createAsyncThunk(
  'sensors/tag',
  async (
    { sensorId, tag, ttl }: { sensorId: string; tag: string; ttl?: number },
    { rejectWithValue }
  ) => {
    try {
      const response = await api.tagSensor(sensorId, tag, ttl);
      if (response.success) {
        return { sensorId, tag };
      }
      return rejectWithValue(response.error || 'Failed to tag sensor');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to tag sensor');
    }
  }
);

export const untagSensor = createAsyncThunk(
  'sensors/untag',
  async (
    { sensorId, tag }: { sensorId: string; tag: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await api.untagSensor(sensorId, tag);
      if (response.success) {
        return { sensorId, tag };
      }
      return rejectWithValue(response.error || 'Failed to untag sensor');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to untag sensor');
    }
  }
);

export const bulkTagSensors = createAsyncThunk(
  'sensors/bulkTag',
  async (
    { sensorIds, tag, ttl }: { sensorIds: string[]; tag: string; ttl?: number },
    { rejectWithValue }
  ) => {
    try {
      const response = await api.bulkTag(sensorIds, tag, ttl);
      if (response.success) {
        return { sensorIds, tag };
      }
      return rejectWithValue(response.error || 'Failed to bulk tag sensors');
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to bulk tag sensors'
      );
    }
  }
);

export const fetchAllFilteredSensorIds = createAsyncThunk(
  'sensors/fetchAllFilteredIds',
  async (filters: ListSensorsRequest | undefined, { rejectWithValue }) => {
    try {
      // Fetch all sensors matching the filter (no pagination)
      const allFilters = { ...filters, limit: MAX_FETCH_ALL_LIMIT, offset: 0 };
      const response = await api.listSensors(allFilters);
      if (response.success && response.data) {
        return response.data.sensors.map((s: Sensor) => s.sid);
      }
      return rejectWithValue(response.error || 'Failed to fetch sensor IDs');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch sensor IDs');
    }
  }
);

export const isolateSensor = createAsyncThunk(
  'sensors/isolate',
  async (sensorId: string, { rejectWithValue }) => {
    try {
      const response = await api.isolateSensor(sensorId);
      if (response.success) {
        return sensorId;
      }
      return rejectWithValue(response.error || 'Failed to isolate sensor');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to isolate sensor');
    }
  }
);

export const rejoinSensor = createAsyncThunk(
  'sensors/rejoin',
  async (sensorId: string, { rejectWithValue }) => {
    try {
      const response = await api.rejoinSensor(sensorId);
      if (response.success) {
        return sensorId;
      }
      return rejectWithValue(response.error || 'Failed to rejoin sensor');
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to rejoin sensor');
    }
  }
);

// Slice
const sensorsSlice = createSlice({
  name: 'sensors',
  initialState,
  reducers: {
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
      // Reset to first page when filters change
      state.filters.offset = 0;
      state.pagination.page = 1;
    },
    setPage: (state, action) => {
      const page = action.payload;
      state.pagination.page = page;
      state.filters.offset = (page - 1) * state.pagination.pageSize;
    },
    setPageSize: (state, action) => {
      const pageSize = action.payload;
      state.pagination.pageSize = pageSize;
      state.filters.limit = pageSize;
      // Reset to first page when page size changes
      state.pagination.page = 1;
      state.filters.offset = 0;
    },
    selectSensor: (state, action) => {
      state.selectedSensor = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch sensors
    builder.addCase(fetchSensors.pending, (state) => {
      state.loading = true;
      state.error = null;
    });
    builder.addCase(fetchSensors.fulfilled, (state, action) => {
      state.loading = false;
      state.sensors = action.payload.sensors;
      state.pagination.total = action.payload.total;
      state.pagination.page = action.payload.page;
      state.pagination.pageSize = action.payload.pageSize;
      state.pagination.hasMore = state.sensors.length >= state.pagination.pageSize;
    });
    builder.addCase(fetchSensors.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload as string;
    });

    // Tag sensor
    builder.addCase(tagSensor.fulfilled, (state, action) => {
      const { sensorId, tag } = action.payload;
      const sensor = state.sensors.find((s) => s.sid === sensorId);
      if (sensor && sensor.tags) {
        if (!sensor.tags.includes(tag)) {
          sensor.tags.push(tag);
        }
      }
    });

    // Untag sensor
    builder.addCase(untagSensor.fulfilled, (state, action) => {
      const { sensorId, tag } = action.payload;
      const sensor = state.sensors.find((s) => s.sid === sensorId);
      if (sensor && sensor.tags) {
        sensor.tags = sensor.tags.filter((t) => t !== tag);
      }
    });

    // Bulk tag
    builder.addCase(bulkTagSensors.fulfilled, (state, action) => {
      const { sensorIds, tag } = action.payload;
      sensorIds.forEach((sensorId) => {
        const sensor = state.sensors.find((s) => s.sid === sensorId);
        if (sensor && sensor.tags && !sensor.tags.includes(tag)) {
          sensor.tags.push(tag);
        }
      });
    });

    // Isolate sensor
    builder.addCase(isolateSensor.fulfilled, (state, action) => {
      const sensor = state.sensors.find((s) => s.sid === action.payload);
      if (sensor) {
        sensor.is_isolated = true;
      }
    });

    // Rejoin sensor
    builder.addCase(rejoinSensor.fulfilled, (state, action) => {
      const sensor = state.sensors.find((s) => s.sid === action.payload);
      if (sensor) {
        sensor.is_isolated = false;
      }
    });
  },
});

export const { setFilters, setPage, setPageSize, selectSensor, clearError } =
  sensorsSlice.actions;
export default sensorsSlice.reducer;
