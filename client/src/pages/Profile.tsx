import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE, ROLE_CAN } from '../lib/format';
import { Avatar } from '../components/Layout';
import { Button, Card, Detail, Field, Notice, PageHeader, buttonClass } from '../components/ui';

/** The logged-in user's own details, with a way to change their password and to log out. */
export function Profile() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (newPassword !== again) return setError('The two new passwords are not the same. Please type them again.');
    setSaving(true);
    setError('');
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setDone(true);
      setCurrent('');
      setNew('');
      setAgain('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="My Profile" />
      <div className="max-w-2xl space-y-5">
        <Card className="p-6">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={user.name} large />
            <div>
              <div className="text-2xl font-bold">{user.name}</div>
              <div className="text-slate-600">{ROLE[user.role]}</div>
            </div>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Email (used to log in)">{user.email}</Detail>
            <Detail label="What this user can do">{ROLE_CAN[user.role]}</Detail>
          </dl>
          <p className="mt-4 text-sm text-slate-500">To change your name or role, ask an Admin.</p>
          <Button className="mt-4" onClick={() => void logout()}>
            Log out
          </Button>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-bold">Change Password</h2>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <Field label="Current password">
              <input className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            <Field label="Type the new password again">
              <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            {done && <Notice tone="success">Your password was changed. Use the new one the next time you log in.</Notice>}
            <button type="submit" disabled={saving || !currentPassword || !newPassword || !again} className={buttonClass('primary')}>
              {saving ? 'Saving…' : 'Change Password'}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
