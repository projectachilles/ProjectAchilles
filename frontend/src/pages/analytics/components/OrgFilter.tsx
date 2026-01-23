import { Building2 } from 'lucide-react';
import type { OrganizationInfo } from '../../../services/api/analytics';

interface OrgFilterProps {
  organizations: OrganizationInfo[];
  selectedOrg: string | null;
  onChange: (org: string | null) => void;
  loading?: boolean;
}

export default function OrgFilter({ organizations, selectedOrg, onChange, loading }: OrgFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Building2 className="w-4 h-4 text-muted-foreground" />
      <select
        value={selectedOrg || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        <option value="">All Organizations</option>
        {organizations.map((org) => (
          <option key={org.uuid} value={org.uuid}>
            {org.shortName} - {org.fullName}
          </option>
        ))}
      </select>
    </div>
  );
}
