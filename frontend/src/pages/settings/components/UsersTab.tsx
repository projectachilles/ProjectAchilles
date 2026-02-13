import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { usersApi, type UserInfo, type InvitationInfo } from '@/services/api/users';
import {
  VALID_ROLES, ROLE_LABELS, ROLE_COLORS, ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS, PERMISSION_CATEGORIES,
} from '@/types/roles';
import type { AppRole } from '@/types/roles';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { AlertTriangle, RefreshCw, Send, X, ChevronDown, Check, Minus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function timeAgo(epoch: number): string {
  const seconds = Math.floor((Date.now() - epoch) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function UsersTab() {
  const { user: currentUser } = useUser();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'destructive' } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('explorer');
  const [inviting, setInviting] = useState(false);
  const [invitations, setInvitations] = useState<InvitationInfo[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Permission reference
  const [permRefOpen, setPermRefOpen] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await usersApi.listUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const data = await usersApi.listInvitations();
      setInvitations(data);
    } catch {
      // Non-critical — don't block the page
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvitations();
  }, [fetchUsers, fetchInvitations]);

  const unassignedCount = users.filter(u => !u.role).length;

  async function handleRoleChange(userId: string, value: string) {
    setPendingUserId(userId);
    try {
      if (value === '') {
        await usersApi.removeRole(userId);
        setToast({ message: 'Role removed — user has full access', variant: 'success' });
      } else {
        await usersApi.setRole(userId, value as AppRole);
        setToast({ message: `Role updated to ${ROLE_LABELS[value as AppRole]}`, variant: 'success' });
      }
      await fetchUsers();
      // If the admin changed their own role, reload the Clerk session
      // so the header badge and permission checks update immediately.
      if (userId === currentUser?.id) {
        await currentUser.reload();
      }
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to update role',
        variant: 'destructive',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await usersApi.inviteUser(inviteEmail.trim(), inviteRole);
      setToast({ message: `Invitation sent to ${inviteEmail.trim()}`, variant: 'success' });
      setInviteEmail('');
      setInviteRole('explorer');
      await fetchInvitations();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to send invitation',
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    setRevokingId(invitationId);
    try {
      await usersApi.revokeInvitation(invitationId);
      setToast({ message: 'Invitation revoked', variant: 'success' });
      await fetchInvitations();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to revoke invitation',
        variant: 'destructive',
      });
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) return <Loading message="Loading users..." />;
  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">User Roles</h2>
          <p className="text-sm text-muted-foreground">Assign roles to control platform access</p>
        </div>
        <button
          onClick={() => { fetchUsers(); fetchInvitations(); }}
          className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex items-end gap-3 mb-6">
        <div className="flex-1">
          <Input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={inviting}
          />
        </div>
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as AppRole)}
          disabled={inviting}
          className="h-[42px] text-sm rounded-lg border border-border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {VALID_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={inviting || !inviteEmail.trim()} className="h-[42px]">
          {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>Invite</span>
        </Button>
      </form>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Pending Invitations ({invitations.length})
          </h3>
          <div className="border border-border rounded-lg divide-y divide-border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm truncate">{inv.emailAddress}</span>
                  {inv.role && (
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                      ROLE_COLORS[inv.role as AppRole] ?? 'text-zinc-700 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800/50'
                    )}>
                      {ROLE_LABELS[inv.role as AppRole] ?? inv.role}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(inv.createdAt)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(inv.id)}
                  disabled={revokingId === inv.id}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                >
                  {revokingId === inv.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <X className="w-3.5 h-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unassigned warning */}
      {unassignedCount > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>{unassignedCount}</strong> user{unassignedCount > 1 ? 's have' : ' has'} no
            assigned role and currently {unassignedCount > 1 ? 'have' : 'has'} full Administrator access.
          </span>
        </div>
      )}

      {/* User list */}
      <div className="border border-border rounded-lg divide-y divide-border">
        {users.map((u) => {
          const isSelf = currentUser?.id === u.id;
          return (
            <div key={u.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={u.imageUrl}
                  alt=""
                  className="w-8 h-8 rounded-full shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {u.firstName} {u.lastName}
                    {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}

                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* Current role badge */}
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  u.role ? ROLE_COLORS[u.role] : 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30'
                )}>
                  {u.role ? ROLE_LABELS[u.role] : 'No role'}
                </span>

                {/* Role selector */}
                <select
                  disabled={pendingUserId === u.id}
                  value={u.role ?? ''}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                  className="text-sm rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">No role (full access)</option>
                  {VALID_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {/* Permission reference */}
      <div className="mt-8 border border-border rounded-lg">
        <button
          onClick={() => setPermRefOpen(!permRefOpen)}
          className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-accent/50 rounded-lg transition-colors"
        >
          <span className="text-sm font-medium">Role Permissions Reference</span>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', permRefOpen && 'rotate-180')} />
        </button>

        {permRefOpen && (
          <div className="px-4 pb-4">
            {/* Role summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {VALID_ROLES.map((role) => (
                <div key={role} className="text-xs p-2 rounded-lg bg-muted/50">
                  <span className={cn('font-medium px-1.5 py-0.5 rounded-full', ROLE_COLORS[role])}>
                    {ROLE_LABELS[role]}
                  </span>
                  <p className="mt-1.5 text-muted-foreground leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
              ))}
            </div>

            {/* Permission table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Permission</th>
                    {VALID_ROLES.map((role) => (
                      <th key={role} className="text-center py-2 px-2 font-medium text-muted-foreground w-20">
                        {ROLE_LABELS[role]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_CATEGORIES.map((cat) => (
                    <>
                      <tr key={cat.label}>
                        <td colSpan={VALID_ROLES.length + 1} className="pt-3 pb-1 font-semibold text-foreground">
                          {cat.label}
                        </td>
                      </tr>
                      {cat.permissions.map((perm) => (
                        <tr key={perm.key} className="border-b border-border/50">
                          <td className="py-1.5 pr-4 text-muted-foreground pl-3">{perm.label}</td>
                          {VALID_ROLES.map((role) => {
                            const has = ROLE_PERMISSIONS[role].includes(perm.key);
                            return (
                              <td key={role} className="text-center py-1.5 px-2">
                                {has
                                  ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mx-auto" />
                                  : <Minus className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <Toast
            variant={toast.variant}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
