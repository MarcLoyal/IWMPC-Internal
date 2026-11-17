import { useEffect, useState } from 'react';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { printOneBill } from '../lib/printBills';
import { useAuth } from '../lib/auth';
import { createPortal } from 'react-dom';
import { useLoad } from '../lib/useLoad';
import { periodLabel } from '../lib/water';
import { BillContent, type BillView } from './BillView';
import { Button, Loading, Notice } from './ui';

/**
 * A water bill shown as a pop-up over the page. While it is open, Print prints only the bill:
 * the pop-up sits outside the page and the page itself is hidden on paper.
 */
export function BillModal({ billId, onClose }: { billId: number; onClose: () => void }) {
  const { data, error, loading, reload } = useLoad<BillView>(`/water/bills/${billId}`);
  const canPrint = useAuth().can('ADMIN', 'STAFF', 'CASHIER');
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

  // The same paper form as batch printing (PDF), one bill on the page.
  async function printPaper() {
    setPrinting(true);
    setPrintError('');
    try {
      await printOneBill(billId);
      void reload();
    } catch (err) {
      setPrintError(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('print-popup');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('print-popup');
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 print:static print:block print:bg-white print:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Water Bill" className="my-auto w-full max-w-2xl rounded-xl bg-white shadow-xl print:max-w-none print:shadow-none">
        <div className="no-print flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-xl font-bold">Water Bill{data ? ` · ${periodLabel(data.bill.period)}` : ''}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </div>
        <div className="px-7 py-5 print:p-0">
          {loading && !data && <Loading what="bill" />}
          {error && <Notice tone="error">{error}</Notice>}
          {data && <BillContent data={data} />}
        </div>
        <div className="no-print flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-4">
          <span className="mr-auto text-sm text-slate-600">
            {data?.lastPrinted ? `Last printed ${formatDateTime(data.lastPrinted.at)} by ${data.lastPrinted.by}` : data ? 'Not printed yet' : ''}
            {printError && <span className="block text-red-700">{printError}</span>}
          </span>
          {canPrint && (
            <Button onClick={() => void printPaper()} disabled={!data || printing}>
              {printing ? 'Preparing…' : 'Print Bill'}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
