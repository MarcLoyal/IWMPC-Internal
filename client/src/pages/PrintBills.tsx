import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Area } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { periodLabel } from '../lib/water';
import type { NoticeHeader, Paper, PrintHeader } from '../lib/billPdf';
import { buildPdf, download, fetchBills, openPrintWindow, recordPrinted, showPdf } from '../lib/printBills';
import { Button, Card, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

interface Summary {
  period: string;
  periods: string[];
  areas: Area[];
  header: PrintHeader;
  notice: NoticeHeader;
  bills: number;
  monthlyBills: number;
  notices: number;
  pages: number;
  pagesPerArea: number;
  byArea: { id: number; name: string; bills: number; monthly: number; notices: number }[];
  missing: { accountId: number; name: string; area: string; meterNo: string }[];
}

interface Result {
  at: string;
  bills: number;
  files: { name: string; url: string; bills: number }[];
}

const choice = (on: boolean) =>
  `rounded-lg border-2 px-4 py-2.5 text-left font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'}`;

/** Batch printing of water bills, 4 to a page, matching IWMPC's paper form. */
export function PrintBills() {
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? '';
  const areaIds = (params.get('areaIds') ?? '').split(',').filter(Boolean);
  // Which form: monthly bills, 2-month notices, or both (two separate PDFs).
  const form = params.get('form') === 'bill' ? 'bill' : params.get('form') === 'notice' ? 'notice' : 'both';
  const disconnectDate = params.get('disconnectDate') ?? '';
  const query = new URLSearchParams();
  if (period) query.set('period', period);
  if (areaIds.length) query.set('areaIds', areaIds.join(','));
  if (form !== 'both') query.set('form', form);
  if (disconnectDate) query.set('disconnectDate', disconnectDate);
  const summary = useLoad<Summary>(`/water/print/summary?${query}`);
  const data = summary.data;

  const [paper, setPaper] = useState<Paper | null>(null);
  const [perArea, setPerArea] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const urls = useRef<string[]>([]);
  const chosenPaper: Paper = paper ?? data?.header.paper ?? 'LETTER';

  // Free the PDFs from memory when leaving the page.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setResult(null);
    setParams(next, { replace: true });
  }

  function toggleArea(id: number) {
    const ids = new Set(areaIds);
    if (ids.has(String(id))) ids.delete(String(id));
    else ids.add(String(id));
    set('areaIds', [...ids].join(','));
  }

  async function print() {
    if (!data) return;
    setError('');
    setResult(null);
    // One file: open the window now, while the click still counts, then fill it when ready.
    // Only one file opens by itself; with several (per area, or bills and notices) they are listed.
    const win = perArea || form === 'both' ? null : openPrintWindow();
    try {
      setBusy('Getting the bills…');
      const q = new URLSearchParams(query);
      q.set('period', data.period);
      const { header, noticeHeader, signatures, bills } = await fetchBills(q, (done, total) =>
        setBusy(`Getting the bills… ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`),
      );
      const job = { header, noticeHeader, signatures, bills };
      const forms = (['BILL', 'NOTICE'] as const).filter((f) => (f === 'BILL' ? form !== 'notice' : form !== 'bill'));
      const groups: { label: string; slug: string; form: 'BILL' | 'NOTICE'; list: typeof bills }[] = [];
      for (const f of forms) {
        const ofForm = bills.filter((b) => b.form === f);
        const kind = f === 'NOTICE' ? 'notices' : 'bills';
        if (perArea) {
          for (const area of data.byArea) {
            const list = ofForm.filter((b) => b.area === area.name);
            if (list.length) groups.push({ label: `${area.name} ${kind}`, slug: `${kind}-${area.name.toLowerCase().replace(/\s+/g, '-')}`, form: f, list });
          }
        } else if (ofForm.length) {
          groups.push({ label: f === 'NOTICE' ? '2-month notices' : 'Monthly bills', slug: kind, form: f, list: ofForm });
        }
      }
      const files: Result['files'] = [];
      for (const g of groups) {
        setBusy(`Making the PDF: ${g.label} (${g.list.length.toLocaleString('en-US')})…`);
        const blob = await buildPdf(job, g.list, g.form, chosenPaper);
        const name = `water-${g.slug}-${data.period}.pdf`;
        // A single file opens straight away in the window opened on click; several are listed.
        const url = groups.length === 1 ? showPdf(win, blob, name) : URL.createObjectURL(blob);
        urls.current.push(url);
        files.push({ name, url, bills: g.list.length });
      }
      if (groups.length !== 1) win?.close();
      await recordPrinted(bills.map((b) => b.billId));
      setResult({ at: new Date().toISOString(), bills: bills.length, files });
    } catch (err) {
      win?.close();
      setError(errorMessage(err) || 'The bills could not be prepared. Please try again.');
    } finally {
      setBusy('');
    }
  }

  const missing = data?.missing ?? [];
  const pages = perArea ? data?.pagesPerArea : data?.pages;

  return (
    <>
      <PageHeader
        title="Print Bills"
        subtitle="Water Service Billing, 4 bills on each sheet. Cut along the dotted lines."
        back={{ to: '/water', label: 'Back to Meter Readings' }}
      >
        <LinkButton to="/settings">Names and phone on the bill</LinkButton>
      </PageHeader>
      {summary.error && <Notice tone="error">{summary.error}</Notice>}
      {summary.loading && !data && <Loading what="bills" />}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <Card className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Billing month">
                <select className="input" value={data.period} onChange={(e) => set('period', e.target.value)}>
                  {(data.periods.length ? data.periods : [data.period]).map((p) => (
                    <option key={p} value={p}>
                      {periodLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Paper size">
                <select className="input" value={chosenPaper} onChange={(e) => setPaper(e.target.value as Paper)}>
                  <option value="LETTER">Short bond (Letter)</option>
                  <option value="LONG">Long bond (8.5 × 13)</option>
                </select>
              </Field>
            </div>

            <div>
              <div className="label">Areas</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={areaIds.length === 0} onClick={() => set('areaIds', '')} className={choice(areaIds.length === 0)}>
                  All areas
                </button>
                {data.areas.map((a) => (
                  <button key={a.id} type="button" aria-pressed={areaIds.includes(String(a.id))} onClick={() => toggleArea(a.id)} className={choice(areaIds.includes(String(a.id)))}>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="label">Which form</div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['', 'Both (two PDFs)'],
                    ['bill', 'Monthly bills'],
                    ['notice', '2-month notices'],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={(value || 'both') === form} onClick={() => set('form', value)} className={choice((value || 'both') === form)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Accounts with {data.notice.thresholdMonths} or more unpaid months get the 2-month notice instead of the monthly bill.
              </p>
            </div>

            {form !== 'bill' && (
              <Field
                label="Disconnection date on the notices"
                hint={disconnectDate ? 'This date is printed on every notice in this batch.' : 'Leave blank to use each account’s due date plus the days set in Settings.'}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <input className="input w-auto" type="date" value={disconnectDate} onChange={(e) => set('disconnectDate', e.target.value)} />
                  {disconnectDate && (
                    <button type="button" className="font-semibold text-brand-700 underline" onClick={() => set('disconnectDate', '')}>
                      Use the rule instead
                    </button>
                  )}
                </span>
              </Field>
            )}

            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={perArea} onChange={(e) => setPerArea(e.target.checked)} />
              <span>
                <span className="font-semibold">One PDF for each area</span>
                <span className="block text-sm text-slate-600">So each area&apos;s bills come out together for the person delivering them.</span>
              </span>
            </label>
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{periodLabel(data.period)}</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">
                {data.bills.toLocaleString('en-US')} {data.bills === 1 ? 'account' : 'accounts'}
              </div>
              <div className="text-lg font-semibold text-slate-800">
                {[
                  form !== 'notice' && `${data.monthlyBills.toLocaleString('en-US')} monthly ${data.monthlyBills === 1 ? 'bill' : 'bills'}`,
                  form !== 'bill' && `${data.notices.toLocaleString('en-US')} ${data.notices === 1 ? 'notice' : 'notices'}`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </div>
              <div className="text-lg text-slate-700">
                on {pages?.toLocaleString('en-US')} {pages === 1 ? 'page' : 'pages'}
              </div>
              {data.byArea.length > 0 && (
                <p className="mt-2 text-slate-600">{data.byArea.map((a) => `${a.name} ${a.bills}`).join(', ')}</p>
              )}
              {form !== 'bill' && data.notices > 0 && (
                <p className="mt-1 text-sm text-slate-600">
                  Notices: {data.notice.perPage === 1 ? '1 per page, landscape' : '2 per page'} (Settings).
                </p>
              )}
              <Button variant="primary" className="mt-4 w-full py-3.5 text-lg" onClick={print} disabled={!!busy || data.bills === 0}>
                {busy ? 'Preparing…' : 'Print / Download PDF'}
              </Button>
              {busy && (
                <p className="mt-2 font-semibold text-brand-800" aria-live="polite">
                  {busy}
                </p>
              )}
              {data.bills === 0 && <p className="mt-2 text-slate-600">No bills to print for these choices.</p>}
              {error && (
                <Notice tone="error" className="mt-3">
                  {error}
                </Notice>
              )}
              {result && (
                <Notice tone="success" className="mt-3">
                  <div className="font-bold">
                    {result.bills.toLocaleString('en-US')} bills ready ({formatDateTime(result.at)}).
                  </div>
                  <div className="font-normal">
                    {result.files.length === 1 ? 'The PDF opened in a new tab. Print it from there.' : 'Open each PDF below and print it.'} You can print again anytime.
                  </div>
                  <ul className="mt-2 space-y-1">
                    {result.files.map((f) => (
                      <li key={f.url} className="flex flex-wrap items-center gap-3">
                        <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">
                          Open {f.name}
                        </a>
                        <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => download(f.url, f.name)}>
                          Download
                        </button>
                        <span className="text-sm text-slate-600">{f.bills} bills</span>
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
            </Card>

            {missing.length > 0 && (
              <Notice tone="warning">
                <div className="font-bold">
                  {missing.length === 1 ? '1 active connection has' : `${missing.length} active connections have`} no meter reading for{' '}
                  {periodLabel(data.period)}, so {missing.length === 1 ? 'its bill' : 'their bills'} cannot be printed yet:
                </div>
                <ul className="mt-1 list-disc pl-6 font-normal">
                  {(showAllMissing ? missing : missing.slice(0, 8)).map((c) => (
                    <li key={`${c.accountId}-${c.meterNo}`}>
                      {c.name} · {c.area}
                      {c.meterNo && ` · ${c.meterNo}`}
                    </li>
                  ))}
                </ul>
                {missing.length > 8 && (
                  <button type="button" className="mt-1 font-semibold underline" onClick={() => setShowAllMissing((s) => !s)}>
                    {showAllMissing ? 'Show fewer' : `Show all ${missing.length}`}
                  </button>
                )}
                <div className="mt-2 font-normal">
                  <LinkButton to={`/water?period=${data.period}`} className="mt-1 bg-white">
                    Enter the missing readings
                  </LinkButton>
                </div>
              </Notice>
            )}
          </div>
        </div>
      )}
    </>
  );
}
