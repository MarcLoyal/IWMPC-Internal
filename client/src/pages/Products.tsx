import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, peso } from '../lib/format';
import { KIND_LABEL, type PriceChange, type Product, type ProductKind, type ProductUnit } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Badge, Button, Card, Field, Loading, Modal, Notice, PageHeader } from '../components/ui';

type Dialog =
  | { kind: 'price'; product: Product; unit: ProductUnit }
  | { kind: 'unit'; product: Product }
  | { kind: 'product' }
  | { kind: 'history'; product: Product };

const priceText = (value: string | null) => (value === null ? '—' : peso(value));

/**
 * Rice & LPG products and prices. Everyone can see them; only an Admin gets the buttons, and the
 * server refuses changes from anyone else.
 */
export function Products() {
  const { can } = useAuth();
  const admin = can('ADMIN');
  const { data, error, loading, reload } = useLoad<{ products: Product[] }>('/products?all=1');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [problem, setProblem] = useState('');
  // Products and units no longer sold are hidden unless asked for. They are kept for past sales.
  const [showRetired, setShowRetired] = useState(false);
  const retired = (data?.products ?? []).reduce((n, p) => n + (p.active ? p.units.filter((u) => !u.active).length : 1), 0);

  const done = () => {
    setDialog(null);
    void reload();
  };

  async function toggle(action: () => Promise<unknown>) {
    setProblem('');
    try {
      await action();
      await reload();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Rice & LPG Prices"
        subtitle={admin ? 'Changing a price never changes sales that were already made.' : 'Only an Admin can change prices.'}
        back={admin ? { to: '/settings', label: 'Back to Settings' } : { to: '/cashier', label: 'Back to Cashier' }}
      >
        {admin && (
          <Button variant="primary" onClick={() => setDialog({ kind: 'product' })}>
            + New Product
          </Button>
        )}
      </PageHeader>
      {error && <Notice tone="error">{error}</Notice>}
      {problem && (
        <Notice tone="error" className="mb-4">
          {problem}
        </Notice>
      )}
      {loading && !data && <Loading what="products" />}
      {retired > 0 && (
        <label className="mb-4 flex items-center gap-2 text-slate-700">
          <input type="checkbox" className="h-4 w-4" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show items no longer sold ({retired})
        </label>
      )}

      <div className="max-w-4xl space-y-5">
        {data?.products
          .filter((product) => product.active || showRetired)
          .map((product) => (
          <Card key={product.id}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <h2 className="flex items-center gap-3 text-xl font-bold">
                {product.name}
                {admin ? (
                  <select
                    aria-label={`Kind of product for ${product.name}`}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold"
                    value={product.category}
                    onChange={(e) => toggle(() => api.put(`/products/${product.id}`, { name: product.name, active: product.active, category: e.target.value }))}
                  >
                    {(Object.keys(KIND_LABEL) as ProductKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone="blue" small>
                    {KIND_LABEL[product.category]}
                  </Badge>
                )}
                {!product.active && <Badge tone="gray">Not sold</Badge>}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button className="px-3 py-1.5 text-sm" onClick={() => setDialog({ kind: 'history', product })}>
                  Price History
                </Button>
                {admin && (
                  <>
                    <Button className="px-3 py-1.5 text-sm" onClick={() => setDialog({ kind: 'unit', product })}>
                      + Add Unit
                    </Button>
                    <Button
                      className="px-3 py-1.5 text-sm"
                      onClick={() => toggle(() => api.put(`/products/${product.id}`, { name: product.name, active: !product.active }))}
                    >
                      {product.active ? 'Stop Selling' : 'Sell Again'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <table className="w-full table-fixed">
              <colgroup>
                <col />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                {admin && <col className="w-[290px]" />}
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th py-2">Unit</th>
                  <th className="th py-2 text-right">Price</th>
                  <th className="th py-2 text-right">Member price</th>
                  {admin && <th className="th py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {product.units
                  .filter((unit) => unit.active || showRetired)
                  .map((unit) => (
                  <tr key={unit.id} className={unit.active ? '' : 'text-slate-400'}>
                    <td className="td py-2 font-semibold">
                      {unit.label}
                      {!unit.active && <span className="ml-2 text-sm font-normal">(not sold)</span>}
                    </td>
                    <td className="td py-2 text-right text-lg font-bold tabular-nums">
                      {Number(unit.price) > 0 ? peso(unit.price) : <span className="text-base font-semibold text-amber-700">Not set</span>}
                    </td>
                    <td className="td py-2 text-right tabular-nums">{unit.memberPrice === null ? <span className="text-slate-500">Same price</span> : peso(unit.memberPrice)}</td>
                    {admin && (
                      <td className="td py-2 text-right">
                        <span className="flex justify-end gap-2">
                          <Button variant="primary" className="whitespace-nowrap px-3 py-1.5 text-sm" onClick={() => setDialog({ kind: 'price', product, unit })}>
                            Change Price
                          </Button>
                          <Button
                            className="whitespace-nowrap px-3 py-1.5 text-sm"
                            onClick={() => toggle(() => api.put(`/products/units/${unit.id}`, { label: unit.label, active: !unit.active }))}
                          >
                            {unit.active ? 'Stop Selling' : 'Sell Again'}
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      {dialog?.kind === 'price' && <PriceDialog product={dialog.product} unit={dialog.unit} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'unit' && <ItemDialog product={dialog.product} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'product' && <ItemDialog product={null} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'history' && <HistoryDialog product={dialog.product} onClose={() => setDialog(null)} />}
    </>
  );
}

function PriceDialog({ product, unit, onClose, onDone }: { product: Product; unit: ProductUnit; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(unit.price);
  const [memberPrice, setMemberPrice] = useState(unit.memberPrice ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/products/units/${unit.id}/price`, { price, memberPrice, reason });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Change Price: ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !reason.trim()}>
            {saving ? 'Saving…' : 'Save New Price'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-lg">
        <strong>{product.name}</strong>, {unit.label}. The price now is <strong>{peso(unit.price)}</strong>.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New price (₱)">
          <input className="input text-xl font-semibold tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
        </Field>
        <Field label="Member price (₱)" hint="Leave blank if members pay the same price.">
          <input className="input text-xl font-semibold tabular-nums" inputMode="decimal" value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} />
        </Field>
        <Field label="Reason for the change (required)" className="sm:col-span-2">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier price went up" />
        </Field>
      </div>
      <p className="mt-3 text-sm text-slate-600">Sales already made keep the price they were sold at. This change is added to the price history.</p>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}

/** Adds a new product (with its first unit), or another unit to a product. */
function ItemDialog({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProductKind | ''>('');
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const [memberPrice, setMemberPrice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (product) await api.post(`/products/${product.id}/units`, { label, price, memberPrice });
      else await api.post('/products', { name, category: kind || undefined, label, price, memberPrice });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={product ? `Add Unit: ${product.name}` : 'New Product'}
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
      <div className="grid gap-4 sm:grid-cols-2">
        {!product && (
          <Field label="Product name" className="sm:col-span-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jasmine" autoFocus />
          </Field>
        )}
        {!product && (
          <Field label="Kind" hint="Used to group sales in reports." className="sm:col-span-2">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ProductKind)}>
              <option value="">Choose…</option>
              <option value="RICE">Rice</option>
              <option value="LPG">LPG</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
        )}
        <Field label="Unit (how it is sold)" hint='e.g. "per kilo", "per sack (50 kg)", "per 11 kg tank"' className="sm:col-span-2">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={!!product} />
        </Field>
        <Field label="Price (₱)">
          <input className="input tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Member price (₱)" hint="Leave blank if the same.">
          <input className="input tabular-nums" inputMode="decimal" value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} />
        </Field>
      </div>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}

function HistoryDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data, error, loading } = useLoad<{ history: PriceChange[] }>(`/products/${product.id}/history`);
  return (
    <Modal
      title={`Price History: ${product.name}`}
      wide
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && !data && <Loading />}
      {error && <Notice tone="error">{error}</Notice>}
      {data && data.history.length === 0 && <p className="text-slate-600">No price changes have been recorded yet.</p>}
      {data && data.history.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {data.history.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-bold">{c.unit}</span>
                <span className="text-lg tabular-nums">
                  {c.oldPrice === null ? 'New: ' : <span className="text-slate-500">{peso(c.oldPrice)} → </span>}
                  <strong>{peso(c.newPrice)}</strong>
                </span>
              </div>
              {(c.oldMemberPrice !== null || c.newMemberPrice !== null) && (
                <div className="text-sm tabular-nums text-slate-600">
                  Member price: {priceText(c.oldMemberPrice)} → {priceText(c.newMemberPrice)}
                </div>
              )}
              <div className="text-sm text-slate-600">
                {formatDateTime(c.changedAt)} · {c.changedBy ?? '—'} · Reason: {c.reason}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
