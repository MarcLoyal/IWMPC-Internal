import { useState } from 'react';
import { peso } from '../lib/format';
import type { Product, ProductUnit } from '../lib/types';
import { Button, Field, Notice } from './ui';

/** An item the cashier has added to the sale being made. */
export interface CartItem {
  unitId: number;
  productName: string;
  unitLabel: string;
  price: number;
  quantity: string;
}

const QUANTITY = /^\d{1,6}(\.\d{1,2})?$/;

export function priceOf(unit: ProductUnit, isMember: boolean): number {
  return Number(isMember && unit.memberPrice !== null ? unit.memberPrice : unit.price);
}

/** Money rounded to the centavo, the same way the server does it. */
export function lineAmount(item: CartItem): number {
  return Math.round(Number(item.quantity) * item.price * 100) / 100;
}

export function cartTotal(items: CartItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + lineAmount(item), 0) * 100) / 100;
}

const choice = (on: boolean) =>
  `rounded-lg border-2 px-4 py-3 text-left font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'}`;

/**
 * Builds a Rice & LPG sale: pick the product, pick the unit, type the quantity, add it.
 * More than one item can be added; they all go under one OR number.
 */
export function SaleBuilder({
  products,
  isMember,
  items,
  onChange,
}: {
  products: Product[];
  isMember: boolean;
  items: CartItem[];
  onChange: (items: CartItem[]) => void;
}) {
  const [productId, setProductId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('1');
  const product = products.find((p) => p.id === productId) ?? null;
  // A product sold in only one way needs no second click.
  const unit = product ? (product.units.find((u) => u.id === unitId) ?? (product.units.length === 1 ? product.units[0] : null)) : null;
  const qty = quantity.replace(/,/g, '').trim();
  const qtyOk = QUANTITY.test(qty) && Number(qty) > 0;
  const price = unit ? priceOf(unit, isMember) : 0;

  function add() {
    if (!product || !unit || !qtyOk) return;
    onChange([...items, { unitId: unit.id, productName: product.name, unitLabel: unit.label, price, quantity: qty }]);
    setProductId(null);
    setUnitId(null);
    setQuantity('1');
  }

  if (products.length === 0) {
    return <Notice tone="warning">There are no products to sell yet. An Admin must add them in Settings.</Notice>;
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th py-2">Item</th>
                <th className="th py-2 text-right">Quantity</th>
                <th className="th py-2 text-right">Price</th>
                <th className="th py-2 text-right">Amount</th>
                <th className="th py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, i) => (
                <tr key={i}>
                  <td className="td py-2">
                    <span className="font-bold">{item.productName}</span>
                    <span className="block text-sm text-slate-500">{item.unitLabel}</span>
                  </td>
                  <td className="td py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="td py-2 text-right tabular-nums">{peso(item.price)}</td>
                  <td className="td py-2 text-right text-lg font-bold tabular-nums">{peso(lineAmount(item))}</td>
                  <td className="td py-2 text-right">
                    <Button className="px-3 py-1.5 text-sm" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-50">
              <tr>
                <td className="td py-2 text-lg font-bold" colSpan={3}>
                  Total
                </td>
                <td className="td py-2 text-right text-2xl font-bold tabular-nums">{peso(cartTotal(items))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="label">{items.length ? 'Add another item' : 'Which product?'}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === productId}
            onClick={() => {
              setProductId(p.id);
              setUnitId(null);
            }}
            className={`${choice(p.id === productId)} text-center text-lg`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {product && (
        <>
          <div className="label mt-4">How is it sold?</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {product.units.map((u) => (
              <button key={u.id} type="button" aria-pressed={u.id === unit?.id} onClick={() => setUnitId(u.id)} className={choice(u.id === unit?.id)}>
                <span className="block">{u.label}</span>
                <span className="block text-lg tabular-nums">
                  {Number(priceOf(u, isMember)) > 0 ? peso(priceOf(u, isMember)) : 'Price not set'}
                  {isMember && u.memberPrice !== null && <span className="ml-2 text-sm font-normal text-emerald-700">member price</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {product && unit && (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Quantity" hint="Decimals are allowed, e.g. 2.5">
            <input
              className={`input w-36 text-xl font-semibold tabular-nums ${quantity && !qtyOk ? 'border-red-500' : ''}`}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </Field>
          <div className="pb-7">
            <div className="text-sm font-semibold text-slate-600">Amount</div>
            <div className="text-2xl font-bold tabular-nums">{qtyOk ? peso(Math.round(Number(qty) * price * 100) / 100) : '—'}</div>
          </div>
          <Button variant="primary" className="mb-7" onClick={add} disabled={!qtyOk || price <= 0}>
            {items.length ? 'Add to Sale' : 'Add Item'}
          </Button>
          {price <= 0 && <span className="mb-9 font-semibold text-amber-800">An Admin must set this price in Settings first.</span>}
        </div>
      )}
    </div>
  );
}
