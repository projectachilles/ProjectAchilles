import { Link } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { useAppRole } from '@/hooks/useAppRole';
import { ROLE_LABELS } from '@/types/roles';

/** An account without a role gets the explorer permissions (see getPermissionsForRole). */
const NO_ROLE_LABEL = 'No role (read-only)';

/**
 * Who is signed in, in the sidebar footer next to "log out": name and role,
 * linking to the profile page. The email stays out of the row (it is long and
 * would be in every screenshot) and is offered in the tooltip.
 */
export function AccountRow({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isLoaded } = useUser();
  const role = useAppRole();

  if (!isLoaded || !user) return null;

  const email = user.primaryEmailAddress?.emailAddress ?? '';
  const name = user.fullName?.trim() || user.username?.trim() || email || 'Signed in';
  const title = email && email !== name ? `${name} · ${email}` : name;

  return (
    <Link
      to="/user-profile"
      onClick={onNavigate}
      title={title}
      className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs lowercase text-muted transition-colors hover:bg-raised hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center self-start rounded-full bg-raised font-mono text-[9px] font-medium uppercase text-foreground"
      >
        {name.charAt(0)}
      </span>
      <span className="min-w-0 flex-1 leading-4">
        <span className="block truncate font-medium text-foreground">{name}</span>
        <span className="block truncate text-[10px] text-faint">{role ? ROLE_LABELS[role] : NO_ROLE_LABEL}</span>
      </span>
    </Link>
  );
}
