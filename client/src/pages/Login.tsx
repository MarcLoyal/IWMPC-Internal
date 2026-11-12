import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Notice, buttonClass } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-800 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
              <path d="M12 2.500c3.500 4.300 6 7.400 6 10.700a6 6 0 0 1-12 0c0-3.300 2.500-6.400 6-10.700Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">IWMPC Internal System</h1>
          <p className="mt-1 text-slate-600">Inicbulan Waterworks Multi-purpose Cooperative</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" disabled={busy} className={buttonClass('primary', 'w-full py-3 text-lg')}>
            {busy ? 'Logging in…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
