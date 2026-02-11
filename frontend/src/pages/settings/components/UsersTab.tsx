import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { usersApi, type UserInfo } from '@/services/api/users';
import { VALID_ROLES, ROLE_LABELS, ROLE_COLORS } from '@/types/roles';
import type { AppRole } from '@/types/roles';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function UsersTab() {
  const { user: currentUser } = useUser();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'destructive' } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

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

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

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
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to update role',
        variant: 'destructive',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  if (loading) return <Loading message="Loading users..." />;
  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">User Roles</h2>
          <p className="text-sm text-muted-foreground">Assign roles to control platform access</p>
        </div>
        <button
          onClick={fetchUsers}
          className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {unassignedCount > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>{unassignedCount}</strong> user{unassignedCount > 1 ? 's have' : ' has'} no
            assigned role and currently {unassignedCount > 1 ? 'have' : 'has'} full Administrator access.
          </span>
        </div>
      )}

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
                  disabled={isSelf || pendingUserId === u.id}
                  value={u.role ?? ''}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                  className={cn(
                    'text-sm rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50',
                    isSelf && 'opacity-50 cursor-not-allowed'
                  )}
                  title={isSelf ? 'Cannot change your own role' : undefined}
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
