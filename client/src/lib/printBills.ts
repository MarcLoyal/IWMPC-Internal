import { api } from './api';
import type { Paper, PrintBill, PrintHeader } from './billPdf';

/** Fetches every bill for a print job, 500 at a time, so a big batch never times out. */
export async function fetchBills(query: URLSearchParams, onProgress?: (done: number, total: number) => void) {
  let header: PrintHeader | null = null;
  const bills: PrintBill[] = [];
  let total = Infinity;
  while (bills.length < total) {
    const q = new URLSearchParams(query);
    q.set('offset', String(bills.length));
    q.set('limit', '500');
    const page = await api.get<{ header: PrintHeader; total: number; bills: PrintBill[] }>(`/water/print/bills?${q}`);
    header = page.header;
    total = page.total;
    bills.push(...page.bills);
    onProgress?.(bills.length, total);
    if (page.bills.length === 0) break;
  }
  return { header: header!, bills };
}

export async function buildPdf(header: PrintHeader, bills: PrintBill[], paper: Paper): Promise<Blob> {
  // Let the screen show "Making the PDF…" before the browser gets busy drawing pages.
  await new Promise((resolve) => setTimeout(resolve, 60));
  // The PDF code is large, so it is only downloaded when someone prints.
  const { loadAssets, makeBillsPdf } = await import('./billPdf');
  const bytes = await makeBillsPdf(header, bills, await loadAssets(), paper);
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

/** Records that these bills were printed (and by whom). Never stops the printing if it fails. */
export async function recordPrinted(billIds: number[]) {
  try {
    await api.post('/water/print/record', { billIds });
  } catch {
    /* the PDF is already made; a missing record is not worth bothering the user about */
  }
}

/**
 * Opens a window right away (browsers only allow this straight after a click), shows a short
 * message while the PDF is made, then shows the PDF there so it can be printed.
 */
export function openPrintWindow(): Window | null {
  const win = window.open('', '_blank');
  if (win) {
    win.document.title = 'Preparing bills…';
    win.document.body.innerHTML =
      '<p style="font:20px system-ui,sans-serif;margin:40px;color:#0f172a">Preparing the bills for printing… Please wait.</p>';
  }
  return win;
}

export function showPdf(win: Window | null, blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  if (win && !win.closed) win.location.href = url;
  else download(url, fileName);
  return url;
}

export function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Prints one bill (from the account's customer card), in the first slot of the page. */
export async function printOneBill(billId: number) {
  const win = openPrintWindow();
  try {
    const { header, bills } = await fetchBills(new URLSearchParams({ billIds: String(billId) }));
    const blob = await buildPdf(header, bills, header.paper);
    showPdf(win, blob, `water-bill-${bills[0]?.period ?? ''}-${billId}.pdf`);
    await recordPrinted([billId]);
  } catch (err) {
    win?.close();
    throw err;
  }
}
