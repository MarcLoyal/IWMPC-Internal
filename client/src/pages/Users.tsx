import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE, ROLE_CAN } from '../lib/format';
import type { Role, User } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Badge, Button, Card, Field, Loading, Modal, Notice, PageHeader } from '../components/ui';

const ROLES: Role[] = ['ADMIN', 'CASHIER', 'STAFF', 'BOARD'];

export function Users() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useLoad<{ users: User[] }>('/users');
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  return (
    <>
      <PageHeader title="Users and Roles" back={{ to: '/settings', label: 'Back to Settings' }}>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + New User
        </Button>
      </PageHeader>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
      {data && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Email</th>
                  <th className="th">Role</th>
                  <th className="th">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((u) => (
                  <tr key={u.id} className={u.status === 'INACTIVE' ? 'text-slate-400' : ''}>
                    <td className="td font-semibold">
                      {u.name} {u.id === me?.id && <span className="font-normal text-slate-500">(you)</span>}
                    </td>
                    <td className="td">{u.email}</td>
                    <td className="td">{ROLE[u.role]}</td>
                    <td className="td">{u.status === 'ACTIVE' ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Deactivated</Badge>}</td>
                    <td className="td text-right">
                      <Button onClick={() => setEditing(u)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function UserDialog({ user, onClose, onDone }: { user: User | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'CASHIER');
  const [status, setStatus] = useState(user?.status ?? 'ACTIVE');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (user) await api.put(`/users/${user.id}`, { name, role, status, password });
      else await api.post('/users', { name, email, role, password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'New User'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" hint={user ? 'The email cannot be changed.' : 'Used to log in.'}>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!user} />
        </Field>
        <Field label="Role" hint={ROLE_CAN[role]}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={user ? 'New password' : 'Password'} hint={user ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {user && (
          <Field label="Status" hint="A deactivated user cannot log in. Their past records stay.">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as User['status'])}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Deactivated</option>
            </select>
          </Field>
        )}
      </div>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
