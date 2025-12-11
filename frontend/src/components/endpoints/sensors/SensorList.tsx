/**
 * Sensor List Component - Table view of sensors
 */

import { Monitor, Shield, Lock, Unlock, Moon, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Badge, StatusDot, PlatformBadge } from '../../shared/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../shared/ui/Table';
import type { Sensor } from '../../../types/endpoints';

interface SensorListProps {
  sensors: Sensor[];
  selectedSensors: string[];
  totalFiltered: number;
  onToggleSelect: (sensorId: string) => void;
  onToggleSelectAll: () => void;
  onSelectAllFiltered?: () => void;
}

export default function SensorList({
  sensors,
  selectedSensors,
  totalFiltered,
  onToggleSelect,
  onToggleSelectAll,
  onSelectAllFiltered,
}: SensorListProps) {
  const getPlatformName = (platId: number): string => {
    switch (platId) {
      case 268435456:
        return 'Windows';
      case 805306368:
        return 'macOS';
      case 536870912:
        return 'Linux';
      default:
        return 'LC_SecOps';
    }
  };

  const isSleeping = (sensor: Sensor): boolean => {
    return sensor.tags?.includes('lc:sleeper') || false;
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'Never';
    try {
      return format(new Date(dateString), 'PPpp');
    } catch {
      return dateString;
    }
  };

  const isAllPageSelected =
    sensors.length > 0 && sensors.every((s) => selectedSensors.includes(s.sid));
  const isAllFilteredSelected = selectedSensors.length === totalFiltered && totalFiltered > 0;
  const hasMoreThanCurrentPage = totalFiltered > sensors.length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Select All Matching Banner */}
      {isAllPageSelected && hasMoreThanCurrentPage && !isAllFilteredSelected && onSelectAllFiltered && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center gap-2">
          <span className="text-sm">
            All {sensors.length} sensors on this page are selected.
          </span>
          <button
            onClick={onSelectAllFiltered}
            className="text-sm font-medium text-primary hover:underline"
          >
            Select all {totalFiltered} matching sensors
          </button>
        </div>
      )}
      {isAllFilteredSelected && hasMoreThanCurrentPage && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center gap-2">
          <span className="text-sm font-medium text-primary">
            All {totalFiltered} matching sensors are selected
          </span>
          <button
            onClick={onToggleSelectAll}
            className="text-sm text-muted-foreground hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12">
              <Checkbox
                checked={isAllPageSelected}
                onChange={onToggleSelectAll}
              />
            </TableHead>
            <TableHead className="w-16">Status</TableHead>
            <TableHead className="w-16">Mode</TableHead>
            <TableHead>Hostname</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>IP Address</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Network</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sensors.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8">
                <p className="text-muted-foreground">No sensors found</p>
              </TableCell>
            </TableRow>
          ) : (
            sensors.map((sensor) => (
              <TableRow
                key={sensor.sid}
                className={selectedSensors.includes(sensor.sid) ? 'bg-primary/5' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedSensors.includes(sensor.sid)}
                    onChange={() => onToggleSelect(sensor.sid)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center" title={sensor.is_online ? 'Online' : 'Offline'}>
                    <StatusDot status={sensor.is_online ? 'online' : 'offline'} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center" title={isSleeping(sensor) ? 'Sleep Mode' : 'Active'}>
                    {isSleeping(sensor) ? (
                      <Moon className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Zap className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getPlatformName(sensor.plat) === 'LC_SecOps' ? (
                      <Shield className="w-4 h-4 text-primary" />
                    ) : (
                      <Monitor className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">{sensor.hostname}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <PlatformBadge platform={getPlatformName(sensor.plat)} />
                </TableCell>
                <TableCell>
                  <span className="font-mono text-sm text-muted-foreground">
                    {sensor.ext_ip || 'N/A'}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(sensor.alive)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {sensor.tags && sensor.tags.length > 0 ? (
                      sensor.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">None</span>
                    )}
                    {sensor.tags && sensor.tags.length > 3 && (
                      <Badge variant="default" className="text-xs">
                        +{sensor.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {sensor.is_isolated ? (
                    <Badge variant="destructive" className="gap-1">
                      <Lock className="w-3 h-3" />
                      Isolated
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <Unlock className="w-3 h-3" />
                      Normal
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
