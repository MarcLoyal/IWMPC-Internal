import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDate, peso } from '../lib/format';
import type { RateClass, RateSchedule } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { blockLabels, currentPeriod, periodLabel } from '../lib/water';
import { Badge, Button, Card, Field, Loading, Modal, Notice, PageHeader } from '../components/ui';

interface Rates {
  thisMonth: string;
  classes: { rateClass: RateClass; label: string; current: RateSchedule | null; versions: RateSchedule[] }[];
}

function RateTable({ rates }: { rates: RateSchedule }) {
  const labels = blockLabels(rates);
  return (
    <table className="w-full max-w-md">
      <thead className="border-b border-slate-200">
        <tr>
          <th className="th px-0">Consumption (cu.m)</th>
          <th className="th px-0 text-right">Price</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        <tr>
          <td className="py-2">0 - {rates.minimumCoversM3}</td>
          <td className="py-2 text-right font-semibold tabular-nums">{peso(rates.minimumCharge)} (minimum charge)</td>
        </tr>
        {rates.tiers.map((t, i) => (
          <tr key={i}>
            <td className="py-2">{labels[i]}</td>
            <td className="py-2 text-right font-semibold tabular-nums">{peso(t.rate)} per cu.m</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Who set these rates, when, and why. */
function WhoChanged({ rates }: { rates: RateSchedule }) {
  if (!rates.changedBy && !rates.note) return null;
  return (
    <p className="mb-2 text-sm text-slate-600">
      {rates.changedBy && rates.changedAt && <>Set by {rates.changedBy} on {formatDate(rates.changedAt)}. </>}
      {rates.note && <>Reason: {rates.note}</>}
    </p>
  );
}

function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function WaterRates() {
  const { data, error, loading, reload } = useLoad<Rates>('/water/rates');
  const [editing, setEditing] = useState<Rates['classes'][number] | null>(null);

  return (
    <>
      <PageHeader
        title="Water Rates"
        subtitle="Changing the rates never changes bills that were already made. New rates apply from the month you choose."
        back={{ to: '/settings', label: 'Back to Settings' }}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
      <div className="max-w-3xl space-y-5">
        {data?.classes.map((c) => {
          const upcoming = c.versions.filter((v) => v.effectiveFrom > data.thisMonth).reverse();
          const past = c.versions.filter((v) => v.effectiveFrom <= data.thisMonth && v.id !== c.current?.id);
          return (
            <Card key={c.rateClass} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{c.label}</h2>
                  {c.current && (
                    <p className="mt-0.5 text-slate-600">
                      In use since {periodLabel(c.current.effectiveFrom)}
                      {c.current.note && <> · {c.current.note}</>}
                    </p>
                  )}
                </div>
                <Button variant="primary" onClick={() => setEditing(c)}>
                  Change Rates
                </Button>
              </div>
              <div className="mt-4">{c.current ? <RateTable rates={c.current} /> : <Notice tone="warning">No rates are set yet.</Notice>}</div>
              {c.current && (
                <p className="mt-3 text-sm text-slate-600">
                  {c.current.method === 'BLOCK'
                    ? 'How it is computed: the minimum charge covers the first cu.m; every cu.m above that is charged at the price of the block the total falls in.'
                    : 'How it is computed: the minimum charge covers the first cu.m; each block above that is charged at its own price.'}
                </p>
              )}

              {upcoming.map((v) => (
                <div key={v.id} className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <div className="mb-2 flex items-center gap-2 font-bold">
                    <Badge tone="yellow">Coming</Badge> New rates starting {periodLabel(v.effectiveFrom)}
                  </div>
                  <WhoChanged rates={v} />
                  <RateTable rates={v} />
                </div>
              ))}
              {past.length > 0 && (
                <details className="mt-5">
                  <summary className="cursor-pointer font-semibold text-brand-700">Earlier rates ({past.length})</summary>
                  {past.map((v) => (
                    <div key={v.id} className="mt-3 border-t border-slate-200 pt-3">
                      <div className="mb-1 font-semibold">From {periodLabel(v.effectiveFrom)}</div>
                      <WhoChanged rates={v} />
                      <RateTable rates={v} />
                    </div>
                  ))}
                </details>
              )}
            </Card>
          );
        })}
      </div>
      {editing && data && (
        <RateDialog
          label={editing.label}
          rateClass={editing.rateClass}
          start={editing.versions[0] ?? null}
          defaultFrom={nextMonth(data.thisMonth)}
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

function RateDialog({
  label,
  rateClass,
  start,
  defaultFrom,
  onClose,
  onDone,
}: {
  label: string;
  rateClass: RateClass;
  start: RateSchedule | null;
  defaultFrom: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(defaultFrom);
  const [minimumCharge, setMinimumCharge] = useState(start?.minimumCharge ?? '');
  const [covers, setCovers] = useState(String(start?.minimumCoversM3 ?? 5));
  const [tiers, setTiers] = useState<{ upTo: string; rate: string }[]>(
    start?.tiers.map((t) => ({ upTo: t.upTo === null ? '' : String(t.upTo), rate: t.rate })) ?? [{ upTo: '', rate: '' }],
  );
  const [method, setMethod] = useState(start?.method ?? 'BLOCK');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setTier = (i: number, patch: Partial<{ upTo: string; rate: string }>) =>
    setTiers((list) => list.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const from = (i: number) => (i === 0 ? Number(covers) + 1 : Number(tiers[i - 1].upTo) + 1);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post('/water/rates', {
        rateClass,
        effectiveFrom,
        minimumCharge,
        minimumCoversM3: covers,
        method,
        note,
        tiers: tiers.map((t) => ({ upTo: t.upTo.trim() === '' ? null : Number(t.upTo), rate: t.rate })),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Change Rates: ${label}`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !note.trim()}>
            {saving ? 'Saving…' : 'Save New Rates'}
          </Button>
        </>
      }
    >
      <Notice tone="info" className="mb-4">
        Bills already made stay exactly as they are. The new rates are used only for bills from the starting month onward.
      </Notice>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="New rates start in">
          <input className="input" type="month" value={effectiveFrom} min={currentPeriod()} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label="Minimum charge (₱)">
          <input className="input tabular-nums" inputMode="decimal" value={minimumCharge} onChange={(e) => setMinimumCharge(e.target.value)} />
        </Field>
        <Field label="Minimum covers the first (cu.m)">
          <input className="input tabular-nums" inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value)} />
        </Field>
      </div>

      <div className="label mt-5">Price per cu.m above the minimum</div>
      <div className="space-y-2">
        {tiers.map((t, i) => {
          const last = i === tiers.length - 1;
          return (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-slate-600">{Number.isFinite(from(i)) ? `From ${from(i)}` : 'From …'} to</span>
                {last ? (
                  <span className="font-semibold">and above</span>
                ) : (
                  <input className="input tabular-nums" inputMode="numeric" aria-label={`Block ${i + 1} ends at`} value={t.upTo} onChange={(e) => setTier(i, { upTo: e.target.value })} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-600">₱</span>
                <input className="input tabular-nums" inputMode="decimal" aria-label={`Block ${i + 1} price per cu.m`} value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} />
              </div>
              <Button onClick={() => setTiers((list) => list.filter((_, idx) => idx !== i))} disabled={tiers.length === 1}>
                Remove
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        className="mt-2"
        onClick={() => setTiers((list) => [...list.slice(0, -1), { upTo: '', rate: list[list.length - 1].rate }, { upTo: '', rate: '' }])}
      >
        + Add Block
      </Button>

      <Field label="How the bill is computed" className="mt-5">
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value as 'BLOCK' | 'PROGRESSIVE')}>
          <option value="BLOCK">Every cu.m above the minimum at the price of the block reached (how IWMPC bills today)</option>
          <option value="PROGRESSIVE">Each block at its own price</option>
        </select>
      </Field>
      <Field label="Reason for the change (required)" className="mt-4">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. New approved tariff" />
      </Field>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
