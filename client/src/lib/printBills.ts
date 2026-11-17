import { api } from './api';
import type { NoticeHeader, Paper, PrintBill, PrintHeader, Signatures, Who } from './billPdf';

/** Everything needed to draw a print job. Signatures arrive only here, never as a link. */
export interface PrintJob {
  header: PrintHeader;
  noticeHeader: NoticeHeader;
  signatures: { bill: Signatures; notice: Signatures };
  bills: PrintBill[];
}

type Page = {
  header: PrintHeader;
  noticeHeader: NoticeHeader;
  signatures: { bill: Partial<Record<Who, string>>; notice: Partial<Record<Who, string>> } | null;
  total: number;
  bills: PrintBill[];
};

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const decode = (set: Partial<Record<Who, string>> = {}): Signatures =>
  Object.fromEntries(Object.entries(set).map(([who, b64]) => [who, fromBase64(b64 as string)])) as Signatures;

/** Fetches every bill for a print job, 500 at a time, so a big batch never times out. */
export async function fetchBills(query: URLSearchParams, onProgress?: (done: number, total: number) => void): Promise<PrintJob> {
  let first: Page | null = null;
  const bills: PrintBill[] = [];
  let total = Infinity;
  while (bills.length < total) {
    const q = new URLSearchParams(query);
    q.set('offset', String(bills.length));
    q.set('limit', '500');
    const page = await api.get<Page>(`/water/print/bills?${q}`);
    first ??= page;
    total = page.total;
    bills.push(...page.bills);
    onProgress?.(bills.length, total);
    if (page.bills.length === 0) break;
  }
  return {
    header: first!.header,
    noticeHeader: first!.noticeHeader,
    signatures: { bill: decode(first!.signatures?.bill), notice: decode(first!.signatures?.notice) },
    bills,
  };
}

/** Makes the PDF for monthly bills (4 a page) or for notices (1 or 2 a page). */
export async function buildPdf(job: PrintJob, bills: PrintBill[], form: 'BILL' | 'NOTICE', paper: Paper): Promise<Blob> {
  // Let the screen show "Making the PDF…" before the browser gets busy drawing pages.
  await new Promise((resolve) => setTimeout(resolve, 60));
  // The PDF code is large, so it is only downloaded when someone prints.
  const { loadAssets, makeBillsPdf, makeNoticesPdf } = await import('./billPdf');
  const assets = await loadAssets();
  const bytes =
    form === 'NOTICE'
      ? await makeNoticesPdf(job.noticeHeader, bills, assets, paper, job.signatures.notice)
      : await makeBillsPdf(job.header, bills, assets, paper, job.signatures.bill);
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

/**
 * Prints one bill (from the account's customer card). Accounts with enough unpaid months get the
 * 2-month notice instead of the monthly bill, as in batch printing.
 */
export async function printOneBill(billId: number) {
  const win = openPrintWindow();
  try {
    const job = await fetchBills(new URLSearchParams({ billIds: String(billId) }));
    const bill = job.bills[0];
    const form = bill?.form === 'NOTICE' ? 'NOTICE' : 'BILL';
    const blob = await buildPdf(job, job.bills, form, form === 'NOTICE' ? job.noticeHeader.paper : job.header.paper);
    showPdf(win, blob, `${form === 'NOTICE' ? 'water-notice' : 'water-bill'}-${bill?.period ?? ''}-${billId}.pdf`);
    await recordPrinted([billId]);
  } catch (err) {
    win?.close();
    throw err;
  }
}
