/**
 * Sensors Page - Main sensor management interface
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState, useRef } from 'react';
import { Play } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchSensors,
  fetchAllFilteredSensorIds,
  setFilters,
  setPage,
  setPageSize,
  tagSensor,
  untagSensor,
  bulkTagSensors,
} from '../../store/sensorsSlice';
import SharedLayout from '../../components/shared/Layout';
import { PageContainer, PageHeader } from '../../components/endpoints/Layout';
import SensorFilters from '../../components/endpoints/sensors/SensorFilters';
import SensorList from '../../components/endpoints/sensors/SensorList';
import SensorPagination from '../../components/endpoints/sensors/SensorPagination';
import TagManager from '../../components/endpoints/sensors/TagManager';
import TaskExecutionDialog from '../../components/endpoints/tasks/TaskExecutionDialog';
import { Button } from '../../components/shared/ui/Button';
import { Alert } from '../../components/shared/ui/Alert';
import { Loading } from '../../components/shared/ui/Spinner';
import { Toast } from '../../components/shared/ui/Alert';

export default function SensorsPage() {
  const dispatch = useAppDispatch();
  const { sensors, filters, loading, error, pagination } = useAppSelector(
    (state) => state.sensors
  );
  const [selectedSensors, setSelectedSensors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const isInitialMount = useRef(true);

  // Auto-refresh when filters change (with debouncing)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      dispatch(fetchSensors(filters));
      return;
    }

    const timeoutId = setTimeout(() => {
      dispatch(fetchSensors(filters));
      setSelectedSensors([]);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [filters, dispatch]);

  const handleFilterChange = (newFilters: any) => {
    dispatch(setFilters(newFilters));
  };

  const handleRefresh = () => {
    dispatch(fetchSensors(filters));
  };

  const handleToggleSelect = (sensorId: string) => {
    setSelectedSensors((prev) =>
      prev.includes(sensorId)
        ? prev.filter((id) => id !== sensorId)
        : [...prev, sensorId]
    );
  };

  const handleToggleSelectAll = () => {
    const allPageIds = sensors.map((s) => s.sid);
    const allPageSelected = allPageIds.every((id) => selectedSensors.includes(id));

    if (allPageSelected) {
      // Deselect all
      setSelectedSensors([]);
    } else {
      // Select all on current page
      setSelectedSensors(allPageIds);
    }
  };

  const handleSelectAllFiltered = async () => {
    // Fetch all sensor IDs matching the current filters
    const result = await dispatch(fetchAllFilteredSensorIds(filters));
    if (fetchAllFilteredSensorIds.fulfilled.match(result)) {
      setSelectedSensors(result.payload as string[]);
    }
  };

  const handleAddTag = async (tag: string) => {
    if (selectedSensors.length === 1) {
      await dispatch(tagSensor({ sensorId: selectedSensors[0], tag }));
      setSuccessMessage(`Tag "${tag}" added to 1 sensor`);
    } else if (selectedSensors.length > 1) {
      await dispatch(bulkTagSensors({ sensorIds: selectedSensors, tag }));
      setSuccessMessage(`Tag "${tag}" added to ${selectedSensors.length} sensors`);
    }
    // Auto-hide success message
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleRemoveTag = async (tag: string) => {
    for (const sensorId of selectedSensors) {
      await dispatch(untagSensor({ sensorId, tag }));
    }
    setSuccessMessage(
      `Tag "${tag}" removed from ${selectedSensors.length} sensor${
        selectedSensors.length !== 1 ? 's' : ''
      }`
    );
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handlePageChange = (newPage: number) => {
    dispatch(setPage(newPage));
    setSelectedSensors([]);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    dispatch(setPageSize(newPageSize));
    setSelectedSensors([]);
  };

  // Create sensor name mapping for task dialog
  const sensorNames = sensors.reduce((acc, sensor) => {
    acc[sensor.sid] = sensor.hostname;
    return acc;
  }, {} as Record<string, string>);

  return (
    <SharedLayout>
      <PageContainer>
        <PageHeader
          title="Sensors"
          description="Manage and monitor your LimaCharlie sensors"
          actions={
            <Button
              disabled={selectedSensors.length === 0}
              onClick={() => setTaskDialogOpen(true)}
            >
              <Play className="w-4 h-4 mr-2" />
              Execute Task ({selectedSensors.length})
            </Button>
          }
        />

        {error && (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        )}

        <SensorFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onRefresh={handleRefresh}
        />

        <TagManager
          selectedCount={selectedSensors.length}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
        />

        {loading ? (
          <Loading message="Loading sensors..." />
        ) : (
          <>
            <SensorPagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />

            <SensorList
              sensors={sensors}
              selectedSensors={selectedSensors}
              totalFiltered={pagination.total}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onSelectAllFiltered={handleSelectAllFiltered}
            />

            <SensorPagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        )}

        <TaskExecutionDialog
          open={taskDialogOpen}
          onClose={() => setTaskDialogOpen(false)}
          selectedSensors={selectedSensors}
          sensorNames={sensorNames}
        />

        {/* Success Toast */}
        {successMessage && (
          <div className="fixed bottom-4 right-4 z-50">
            <Toast
              variant="success"
              message={successMessage}
              onClose={() => setSuccessMessage(null)}
            />
          </div>
        )}
      </PageContainer>
    </SharedLayout>
  );
}
