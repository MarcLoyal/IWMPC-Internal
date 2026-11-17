import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { Button, Card, Notice } from './ui';

interface Slot {
  slot: string;
  print: boolean;
  hasImage: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A small preview, fetched with the Admin's login. Not a link, not a download. */
function Preview({ slot, version }: { slot: string; version: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let current = '';
    let cancelled = false;
    fetch(`/api/signatures/${slot}/preview`, { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        current = URL.createObjectURL(blob);
        setUrl(current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [slot, version]);
  if (!url) return <div className="h-12 w-40 rounded border border-dashed border-slate-300" />;
  return (
    <img
      src={url}
      alt="Signature preview"
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      className="h-12 w-40 rounded border border-slate-200 bg-white object-contain p-1"
    />
  );
}

function SlotRow({ slot, name, title, onChanged }: { slot: Slot; name: string; title: string; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (file.type !== 'image/png') return setError('Please choose a PNG picture.');
    if (file.size > 2 * 1024 * 1024) return setError('The picture is too large. Please use a picture under 2 MB.');
    await run(async () => {
      const res = await fetch(`/api/signatures/${slot.slot}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/png' }, body: file });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'The signature could not be saved.');
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      <div className="min-w-[180px] flex-1">
        <div className="font-semibold">{name || '—'}</div>
        <div className="text-sm text-slate-600">{title}</div>
        {slot.updatedAt && (
          <div className="text-xs text-slate-500">
            Updated {formatDateTime(slot.updatedAt)}
            {slot.updatedBy && ` by ${slot.updatedBy}`}
          </div>
        )}
      </div>
      {slot.hasImage ? <Preview slot={slot.slot} version={slot.updatedAt ?? ''} /> : <span className="w-40 text-sm text-slate-500">No signature yet</span>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/png" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button className="px-3 py-1.5 text-sm" disabled={busy} onClick={() => input.current?.click()}>
          {slot.hasImage ? 'Replace' : 'Upload'}
        </Button>
        {slot.hasImage && (
          <Button className="px-3 py-1.5 text-sm" variant="danger" disabled={busy} onClick={() => run(() => api.delete(`/signatures/${slot.slot}`))}>
            Remove
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4" checked={slot.print} disabled={busy} onChange={(e) => run(() => api.put(`/signatures/${slot.slot}/print`, { print: e.target.checked }))} />
          Print signature
        </label>
      </div>
      {error && (
        <Notice tone="error" className="w-full">
          {error}
        </Notice>
      )}
    </li>
  );
}

/** Admin only: signature images for the monthly bill and the 2-month notice. */
export function SignatureSettings({ names }: { names: Record<string, string> }) {
  const { data, error, reload } = useLoad<{ signatures: Slot[] }>('/signatures');
  const groups = [
    ['bill', 'Monthly bill'],
    ['notice', '2-month notice'],
  ] as const;
  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold">Signatures on Printed Bills</h2>
      <p className="mt-1 text-slate-600">
        Upload a PNG picture of each signature (a white background is removed automatically). Signatures are printed only on the bills and are never shown to
        other users. With no picture, or with &quot;Print signature&quot; off, the name prints with a blank line to sign by hand.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {data &&
        groups.map(([form, label]) => (
          <div key={form} className="mt-4">
            <h3 className="font-bold text-slate-800">{label}</h3>
            <ul className="divide-y divide-slate-100">
              {data.signatures
                .filter((s) => s.slot.startsWith(`${form}_`))
                .map((s) => (
                  <SlotRow key={s.slot} slot={s} name={names[`${s.slot}_name`]} title={names[`${s.slot}_title`]} onChanged={reload} />
                ))}
            </ul>
          </div>
        ))}
    </Card>
  );
}
