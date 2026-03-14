import { useState } from 'react';
import type { TestDetails, TestFile } from '@/types/test';
import { browserApi } from '@/services/api/browser';
import { Shield, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface DefenseDashboardProps {
  test: TestDetails;
}

interface RuleCount {
  kql: number;
  yara: number;
  sigma: number;
  elastic: number;
  dr: number;
  hardening: number;
}

export default function DefenseDashboard({ test }: DefenseDashboardProps) {
  const [expanded, setExpanded] = useState(true);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  // Count detection and defense files
  const detectionFiles = test.files.filter(f => f.category === 'detection');
  const defenseFiles = test.files.filter(f => f.category === 'defense');

  const counts: RuleCount = {
    kql: detectionFiles.filter(f => f.type === 'kql').length,
    yara: detectionFiles.filter(f => f.type === 'yara').length,
    sigma: detectionFiles.filter(f => f.type === 'sigma').length,
    elastic: detectionFiles.filter(f => f.type === 'ndjson').length,
    dr: defenseFiles.filter(f => f.name.includes('_dr_rules')).length,
    hardening: defenseFiles.filter(f => f.name.includes('_hardening')).length,
  };

  const hasAnyRules = Object.values(counts).some(c => c > 0);

  if (!hasAnyRules && !test.hasDefenseGuidance) {
    return null;
  }

  async function copyAllRules(type: 'kql' | 'yara' | 'sigma' | 'elastic' | 'dr') {
    setCopying(true);
    try {
      let files: TestFile[] = [];

      if (type === 'kql') {
        files = detectionFiles.filter(f => f.type === 'kql');
      } else if (type === 'yara') {
        files = detectionFiles.filter(f => f.type === 'yara');
      } else if (type === 'sigma') {
        files = detectionFiles.filter(f => f.type === 'sigma');
      } else if (type === 'elastic') {
        files = detectionFiles.filter(f => f.type === 'ndjson');
      } else if (type === 'dr') {
        files = defenseFiles.filter(f => f.name.includes('_dr_rules'));
      }

      // Fetch all file contents
      const contents = await Promise.all(
        files.map(async f => {
          const fileData = await browserApi.getFileContent(test.uuid, f.name);
          return `# File: ${f.name}\n${fileData.content}`;
        })
      );

      const allContent = contents.join('\n\n' + '='.repeat(80) + '\n\n');
      await navigator.clipboard.writeText(allContent);

      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch (err) {
      console.error('Failed to copy rules:', err);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="border border-border rounded-lg bg-card mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-500" />
          <span className="font-semibold">Defense Readiness</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {counts.kql > 0 && (
              <StatCard label="KQL Queries" count={counts.kql} color="text-blue-500" bgColor="bg-blue-500/10" />
            )}
            {counts.yara > 0 && (
              <StatCard label="YARA Rules" count={counts.yara} color="text-purple-500" bgColor="bg-purple-500/10" />
            )}
            {counts.sigma > 0 && (
              <StatCard label="Sigma Rules" count={counts.sigma} color="text-yellow-500" bgColor="bg-yellow-500/10" />
            )}
            {counts.elastic > 0 && (
              <StatCard label="Elastic Rules" count={counts.elastic} color="text-green-500" bgColor="bg-green-500/10" />
            )}
            {counts.dr > 0 && (
              <StatCard label="D&R Rules" count={counts.dr} color="text-cyan-500" bgColor="bg-cyan-500/10" />
            )}
            {counts.hardening > 0 && (
              <StatCard label="Hardening" count={counts.hardening} color="text-orange-500" bgColor="bg-orange-500/10" />
            )}
          </div>

          {/* Copy Buttons */}
          <div className="flex flex-wrap gap-2">
            {counts.kql > 0 && (
              <CopyButton
                label="Copy All KQL"
                onClick={() => copyAllRules('kql')}
                copied={copiedType === 'kql'}
                disabled={copying}
              />
            )}
            {counts.yara > 0 && (
              <CopyButton
                label="Copy All YARA"
                onClick={() => copyAllRules('yara')}
                copied={copiedType === 'yara'}
                disabled={copying}
              />
            )}
            {counts.sigma > 0 && (
              <CopyButton
                label="Copy All Sigma"
                onClick={() => copyAllRules('sigma')}
                copied={copiedType === 'sigma'}
                disabled={copying}
              />
            )}
            {counts.elastic > 0 && (
              <CopyButton
                label="Copy All Elastic"
                onClick={() => copyAllRules('elastic')}
                copied={copiedType === 'elastic'}
                disabled={copying}
              />
            )}
            {counts.dr > 0 && (
              <CopyButton
                label="Copy D&R Rules"
                onClick={() => copyAllRules('dr')}
                copied={copiedType === 'dr'}
                disabled={copying}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

function StatCard({ label, count, color, bgColor }: StatCardProps) {
  return (
    <div className={`rounded-lg p-3 ${bgColor}`}>
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

interface CopyButtonProps {
  label: string;
  onClick: () => void;
  copied: boolean;
  disabled: boolean;
}

function CopyButton({ label, onClick, copied, disabled }: CopyButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:bg-accent text-sm transition-colors disabled:opacity-50"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 text-green-500" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
