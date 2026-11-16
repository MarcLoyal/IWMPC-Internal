import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, peso } from '../lib/format';
import { KIND_LABEL, type ProductKind, type SaleLine } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Badge, Card, Field, LinkButton, Loading, Notice, PageHeader, PrintButton } from '../components/ui';

interface Report {
  from: string;
  to: string;
  products: { id: number; name: string; category: ProductKind }[];
  totalsByKind: Partial<Record<ProductKind, string>>;
  coop: { name: string; address: string; cdaNo: string };
  summary: { product: string; unit: string; quantity: string; amount: string; sales: number }[];
  total: string;
  creditTotal: string;
  saleCount: number;
  lines: (SaleLine & { saleId: number; date: string; accountId: number | null; buyer: string; walkIn: boolean; isCredit: boolean; orNumbers: string[] })[];
}

/** Rice & LPG sold in a date range: totals per product and unit, then every sale line. */
export function SalesReport() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'productId', 'category']) if (params.get(key)) query.set(key, params.get(key)!);
  const { data, error, loading } = useLoad<Report>(`/sales/report?${query}`);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // One dropdown: all products, all rice, LPG, or a single product.
  const showing = params.get('productId') ? `p${params.get('productId')}` : params.get('category') ? `k${params.get('category')}` : '';
  function setShowing(value: string) {
    const next = new URLSearchParams(params);
    next.delete('productId');
    next.delete('category');
    if (value.startsWith('p')) next.set('productId', value.slice(1));
    if (value.startsWith('k')) next.set('category', value.slice(1));
    setParams(next, { replace: true });
  }
  const kinds = (['RICE', 'LPG', 'OTHER'] as ProductKind[]).filter((k) => data?.products.some((p) => p.category === k));

  return (
    <>
      <div className="mb-4 hidden text-center print:block">
        <img src="/logo.png" alt="" className="mx-auto mb-1 h-16 w-16" />
        <div className="text-lg font-bold">{data?.coop.name}</div>
        {data?.coop.address && <div className="text-sm">{data.coop.address}</div>}
      </div>
      <PageHeader
        title="Rice & LPG Sales"
        subtitle={data ? `${formatDate(data.from)} to ${formatDate(data.to)}` : undefined}
        back={{ to: '/cashier', label: 'Back to Cashier' }}
      >
        <LinkButton to="/prices">See Prices</LinkButton>
        <PrintButton />
      </PageHeader>

      <Card className="no-print mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <input className="input py-2" type="date" value={params.get('from') ?? data?.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input py-2" type="date" value={params.get('to') ?? data?.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} />
          </Field>
          <Field label="Product">
            <select className="input py-2" value={showing} onChange={(e) => setShowing(e.target.value)}>
              <option value="">All products (Rice and LPG)</option>
              {kinds.includes('RICE') && <option value="kRICE">Rice only (all kinds of rice)</option>}
              {kinds.includes('LPG') && <option value="kLPG">LPG only</option>}
              {kinds.includes('OTHER') && <option value="kOTHER">Other products only</option>}
              {kinds.map((k) => (
                <optgroup key={k} label={`One ${KIND_LABEL[k] === 'Other' ? 'other product' : KIND_LABEL[k] === 'Rice' ? 'kind of rice' : 'LPG product'}`}>
                  {data?.products
                    .filter((p) => p.category === k)
                    .map((p) => (
                      <option key={p.id} value={`p${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="report" />}
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_2fr] print:grid-cols-[1fr_2fr]">
            <Card className="avoid-break p-5">
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Total Sales</div>
              <div className="mt-1 text-4xl font-bold tabular-nums">{peso(data.total)}</div>
              <div className="mt-1 text-slate-600">
                {data.saleCount} {data.saleCount === 1 ? 'sale' : 'sales'}
                {Number(data.creditTotal) > 0 && ` · ${peso(data.creditTotal)} of this was on credit`}
              </div>
              {Object.keys(data.totalsByKind).length > 1 && (
                <dl className="mt-3 space-y-0.5 border-t border-slate-200 pt-2">
                  {(['RICE', 'LPG', 'OTHER'] as ProductKind[])
                    .filter((k) => data.totalsByKind[k])
                    .map((k) => (
                      <div key={k} className="flex justify-between gap-4">
                        <dt className="font-semibold text-slate-700">{KIND_LABEL[k]}</dt>
                        <dd className="font-bold tabular-nums">{peso(data.totalsByKind[k]!)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              <div className="mt-1 text-sm text-slate-500">Voided sales are not counted.</div>
            </Card>
            <Card className="avoid-break">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th rounded-tl-xl py-2">Product</th>
                    <th className="th py-2">Unit</th>
                    <th className="th py-2 text-right">Quantity</th>
                    <th className="th rounded-tr-xl py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.summary.map((s) => (
                    <tr key={`${s.product}|${s.unit}`}>
                      <td className="td py-2 font-bold">{s.product}</td>
                      <td className="td py-2 text-slate-700">{s.unit}</td>
                      <td className="td py-2 text-right tabular-nums">{s.quantity}</td>
                      <td className="td py-2 text-right font-bold tabular-nums">{peso(s.amount)}</td>
                    </tr>
                  ))}
                  {data.summary.length === 0 && (
                    <tr>
                      <td className="td text-slate-500" colSpan={4}>
                        No sales in these dates.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          {data.lines.length > 0 && (
            <Card>
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[12%]" />
                  <col />
                  <col className="w-[27%]" />
                  <col className="w-[9%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th rounded-tl-xl py-2">Date</th>
                    <th className="th py-2">OR No.</th>
                    <th className="th py-2">Buyer</th>
                    <th className="th py-2">Item</th>
                    <th className="th py-2 text-right">Qty</th>
                    <th className="th rounded-tr-xl py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="td whitespace-nowrap py-1.5 text-sm">{formatDate(l.date)}</td>
                      <td className="td py-1.5 font-semibold tabular-nums">
                        {l.orNumbers.join(', ') || (l.isCredit ? <Badge tone="yellow" small>On credit</Badge> : '—')}
                      </td>
                      <td className="td py-1.5">
                        {l.accountId ? (
                          <Link to={`/accounts/${l.accountId}`} className="font-semibold text-brand-700 hover:underline print:text-slate-900">
                            {l.buyer}
                          </Link>
                        ) : (
                          <span>
                            {l.buyer} {l.buyer !== 'Walk-in customer' && <span className="text-sm text-slate-500">(walk-in)</span>}
                          </span>
                        )}
                      </td>
                      <td className="td py-1.5">
                        <span className="font-semibold">{l.productName}</span>
                        <span className="block text-xs text-slate-500">
                          {l.unitLabel} at {peso(l.unitPrice)}
                        </span>
                      </td>
                      <td className="td py-1.5 text-right tabular-nums">{l.quantity}</td>
                      <td className="td py-1.5 text-right font-bold tabular-nums">{peso(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                  <tr>
                    <td className="td py-2 font-bold" colSpan={5}>
                      Total
                    </td>
                    <td className="td py-2 text-right text-lg font-bold tabular-nums">{peso(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
          <p className="mt-6 hidden text-sm text-slate-600 print:block">
            Printed {formatDateTime(new Date().toISOString())} by {user?.name}
          </p>
        </div>
      )}
    </>
  );
}
