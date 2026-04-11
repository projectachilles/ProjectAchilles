import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, X, Settings } from 'lucide-react';

const AUTH_METHOD = window.__env__?.AUTH_METHOD || 'basic';

export function BasicAuthBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('basic-auth-banner-dismissed') === '1');
  const navigate = useNavigate();

  if (AUTH_METHOD !== 'basic' || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem('basic-auth-banner-dismissed', '1');
    setDismissed(true);
  };

  return (
    <div className="bg-[#D6490F]/10 border-b border-[#D6490F]/20 px-4 py-2.5 flex items-center gap-3 text-sm">
      <ShieldAlert className="w-4 h-4 text-[#D6490F] shrink-0" />
      <span className="text-[#D6490F] font-medium">
        Basic authentication is for initial setup only.
      </span>
      <span className="text-muted-foreground hidden sm:inline">
        Configure a secure provider (Azure AD, Google, or Clerk) in Settings.
      </span>
      <button
        onClick={() => navigate('/settings')}
        className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-md bg-[#D6490F] text-white hover:bg-[#D6490F]/90 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Go to Settings
      </button>
      <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
