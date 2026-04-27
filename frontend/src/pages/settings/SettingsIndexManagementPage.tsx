import { HardDrive } from 'lucide-react';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { IndexManagement } from './components/IndexManagement';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useNavigate } from 'react-router-dom';
import { I, Icon } from '@/components/layout/AchillesShell';

export default function SettingsIndexManagementPage() {
  const navigate = useNavigate();
  const { configured, loading } = useAnalyticsAuth();

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Storage"
        title="Index Management"
        description="Create and inspect Elasticsearch indices used for test-result ingestion."
      />

      <SettingsCard
        icon={HardDrive}
        title="Indices"
        description="Live view of all indices in the connected Elasticsearch cluster."
        status={configured ? 'connected' : 'not-configured'}
        statusMessage={configured ? 'ES connected' : 'Configure analytics first'}
      >
        {loading ? null : configured ? (
          <IndexManagement />
        ) : (
          <div className="settings-empty">
            <p className="settings-empty-title">Elasticsearch not configured</p>
            <p>
              Connect an Elasticsearch cluster from the Analytics card before managing indices.
            </p>
            <div className="settings-empty-actions">
              <button
                type="button"
                className="dash-quick-btn primary"
                onClick={() => navigate('/settings/analytics')}
              >
                <Icon size={12}>{I.target}</Icon>
                Configure Analytics
              </button>
            </div>
          </div>
        )}
      </SettingsCard>
    </main>
  );
}
