import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, peso } from '../lib/format';
import type { Area, RateClass, RateSchedule } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { computeWaterCharge, currentPeriod, periodLabel } from '../lib/water';
import { Button, Card, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

interface Row {
  connectionId: number;
  accountId: number;
  name: string;
  area: string;
  meter: string;
  rateClass: RateClass;
  previousReading: number;
  currentReading: number | null;
  usualUsage: number | null;
  locked: string | null;
}

interface Sheet {
  period: string;
  today: string;
  rows: Row[];
  rates: Record<RateClass, RateSchedule | null>;
  areas: Area[];
  dueDays: number;
}

interface Result {
  saved: number;
  unchanged: number;
  problems: string[];
}

/** Warnings only: staff can still save. */
function warningFor(row: Row, current: number): string | null {
  if (current < row.previousReading) return 'Lower than the previous reading. Please check.';
  const used = current - row.previousReading;
  if (row.usualUsage !== null && row.usualUsage > 0 && used > row.usualUsage * 3) {
    return `Much higher than usual (about ${row.usualUsage} cu.m). Please check.`;
  }
  return null;
}

export function WaterReadings() {
  const { can } = useAuth();
  const canEnter = can('ADMIN', 'STAFF');
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || currentPeriod();
  const areaId = params.get('areaId') ?? '';
  const { data, error, loading, reload } = useLoad<Sheet>(`/water/readings?period=${period}${areaId ? `&areaId=${areaId}` : ''}`);

  // What staff have typed, by connection. Kept as text so a box can be empty.
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [readDate, setReadDate] = useState('');
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setTyped(Object.fromEntries(data.rows.filter((r) => r.currentReading !== null).map((r) => [r.connectionId, String(r.currentReading)])));
    setReadDate((d) => d || data.today);
  }, [data]);

  function setFilter(key: 'period' | 'areaId', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setResult(null);
    setParams(next, { replace: true });
  }

  const changed = useMemo(
    () =>
      (data?.rows ?? []).filter((r) => {
        const text = (typed[r.connectionId] ?? '').trim();
        return !r.locked && text !== '' && Number(text) !== r.currentReading;
      }),
    [data, typed],
  );
  const invalid = changed.some((r) => !/^\d+$/.test(typed[r.connectionId].trim()));
  const entered = (data?.rows ?? []).filter((r) => (typed[r.connectionId] ?? '').trim() !== '').length;

  async function save() {
    if (!data) return;
    setSaving(true);
    setProblem('');
    setResult(null);
    try {
      const res = await api.post<Result>('/water/readings', {
        period,
        readDate,
        readings: changed.map((r) => ({ connectionId: r.connectionId, currentReading: Number(typed[r.connectionId].trim()) })),
      });
      setResult(res);
      await reload();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Water" subtitle="Enter the monthly meter readings. The bills are made from them.">
        <LinkButton to="/water/overdue">Overdue List</LinkButton>
      </PageHeader>

      <Card className="no-print mb-5 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Billing month">
            <input className="input" type="month" value={period} max={currentPeriod()} onChange={(e) => setFilter('period', e.target.value)} />
          </Field>
          <Field label="Area">
            <select className="input" value={areaId} onChange={(e) => setFilter('areaId', e.target.value)}>
              <option value="">All areas</option>
              {data?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {canEnter && (
            <Field label="Date the meters were read" hint={data ? `Bills will be due ${data.dueDays} days after this date.` : undefined}>
              <input className="input" type="date" value={readDate} max={data?.today} onChange={(e) => setReadDate(e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="connections" />}
      {!canEnter && data && (
        <Notice tone="info" className="no-print mb-4">
          Only Staff or an Admin can enter readings. You can view them here.
        </Notice>
      )}
      {data && (!data.rates.RESIDENTIAL || !data.rates.COMMERCIAL) && (
        <Notice tone="warning" className="mb-4">
          There are no water rates for {periodLabel(period)} yet. An Admin must set them in Settings before bills can be made.
        </Notice>
      )}
      {result && (
        <Notice tone={result.problems.length ? 'warning' : 'success'} className="no-print mb-4">
          <div className="font-bold">
            {result.saved === 0 ? 'No bills were changed.' : `${result.saved} ${result.saved === 1 ? 'bill was' : 'bills were'} saved for ${periodLabel(period)}.`}
          </div>
          {result.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-6 font-normal">
              {result.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {data && (
        <>
          <h2 className="mb-2 hidden text-lg font-bold print:block">Meter Reading Sheet · {periodLabel(period)}</h2>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] print:min-w-0">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Area</th>
                    <th className="th">Name</th>
                    <th className="th">Meter No.</th>
                    <th className="th text-right">Previous</th>
                    <th className="th">Current reading</th>
                    <th className="th text-right">Cu.M</th>
                    <th className="th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r) => {
                    const text = (typed[r.connectionId] ?? '').trim();
                    const valid = /^\d+$/.test(text);
                    const current = valid ? Number(text) : null;
                    const used = current === null ? null : Math.max(0, current - r.previousReading);
                    const rates = data.rates[r.rateClass];
                    const warning = current === null ? null : warningFor(r, current);
                    return (
                      <tr key={r.connectionId}>
                        <td className="td py-2 text-slate-600">{r.area}</td>
                        <td className="td py-2 font-semibold">{r.name}</td>
                        <td className="td py-2 tabular-nums text-slate-600">{r.meter || '—'}</td>
                        <td className="td py-2 text-right tabular-nums">{r.previousReading}</td>
                        <td className="td py-2">
                          <input
                            className={`input w-32 py-1.5 text-lg font-semibold tabular-nums print:border-slate-400 ${warning ? 'border-amber-500 bg-amber-50' : ''} ${text && !valid ? 'border-red-500' : ''}`}
                            inputMode="numeric"
                            aria-label={`Current reading for ${r.name}`}
                            value={typed[r.connectionId] ?? ''}
                            disabled={!canEnter || !!r.locked}
                            onChange={(e) => setTyped((t) => ({ ...t, [r.connectionId]: e.target.value }))}
                          />
                          {r.locked && <span className="no-print ml-2 text-sm text-slate-500">{r.locked}</span>}
                          {text && !valid && <span className="block text-sm font-semibold text-red-700">Numbers only, please.</span>}
                          {warning && <span className="no-print block text-sm font-semibold text-amber-800">⚠ {warning}</span>}
                        </td>
                        <td className="td py-2 text-right text-lg tabular-nums">{used ?? ''}</td>
                        <td className="td py-2 text-right text-lg font-semibold tabular-nums">
                          {used !== null && rates ? peso(computeWaterCharge(used, rates)) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && <p className="px-6 py-12 text-center text-slate-500">No active water connections{areaId ? ' in this area' : ''}.</p>}
          </Card>

          <div className="no-print sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-lg">
            <div className="text-slate-700">
              <strong>{entered}</strong> of {data.rows.length} read for {periodLabel(period)}
              {readDate && canEnter && <> · read on {formatDate(readDate)}</>}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => window.print()}>Print Reading Sheet</Button>
              {canEnter && (
                <Button variant="primary" onClick={save} disabled={saving || changed.length === 0 || invalid || !readDate}>
                  {saving ? 'Saving…' : changed.length ? `Save and Create Bills (${changed.length})` : 'Save and Create Bills'}
                </Button>
              )}
            </div>
          </div>
          {problem && (
            <Notice tone="error" className="mt-4">
              {problem}
            </Notice>
          )}
        </>
      )}
    </>
  );
}
