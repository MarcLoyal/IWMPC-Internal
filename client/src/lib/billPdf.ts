import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/*
 * Printed water bills in IWMPC's "WATER SERVICE BILLING" form, 4 to a page (2 x 2), with dotted
 * cut lines. Black and white only. Each bill sits in its own quarter of the page, so a bill can
 * never be split across pages. All figures come from the server; this file only draws them.
 */

export interface PrintRow {
  kind: 'EARLIER' | 'CURRENT' | 'PAYMENT' | 'COMBINED';
  month: string;
  cubicMeters: number | null;
  amount: string;
  withPenalty: boolean;
}

export interface PrintBill {
  billId: number;
  area: string;
  accountName: string;
  address: string;
  meterNo: string;
  period: string;
  dueDate: string;
  rows: PrintRow[];
  totalDue: string;
}

export interface PrintHeader {
  coopName: string;
  coopAddress: string;
  cdaNo: string;
  phone: string;
  mobile: string;
  dueNote: string;
  paper: 'LETTER' | 'LONG';
  signatories: { name: string; title: string; label: string }[];
}

export const BILLS_PER_PAGE = 4;

/** Page sizes in points (1/72 inch): Letter 8.5 x 11 in, Long bond (folio) 8.5 x 13 in. */
export const PAPER = { LETTER: { width: 612, height: 792 }, LONG: { width: 612, height: 936 } } as const;

export type Paper = keyof typeof PAPER;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where bill number `index` goes: which page, and which quarter (top-left, top-right, bottom-left, bottom-right). */
export function slotFor(index: number, paper: Paper): { page: number; box: Box } {
  const { width, height } = PAPER[paper];
  const slot = index % BILLS_PER_PAGE;
  const col = slot % 2;
  const row = Math.floor(slot / 2);
  // PDF coordinates start at the bottom-left corner.
  return { page: Math.floor(index / BILLS_PER_PAGE), box: { x: col * (width / 2), y: height - (row + 1) * (height / 2), width: width / 2, height: height / 2 } };
}

export function pageCount(bills: number): number {
  return Math.ceil(bills / BILLS_PER_PAGE);
}

/** Something to draw. y is the text baseline (or the bottom of a shape), in page coordinates. */
export type Op =
  | { type: 'text'; text: string; x: number; y: number; size: number; bold: boolean }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'logo'; x: number; y: number; size: number };

export interface Measure {
  width(text: string, size: number, bold: boolean): number;
}

/** ₱1,250.00 and -₱200.00 */
export function peso(value: string | number): string {
  const n = Number(value);
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}₱${text}`;
}

/** Shrinks text to fit a width (down to `min`), then cuts it short with "...". */
function fit(m: Measure, text: string, maxWidth: number, size: number, bold: boolean, min = 5.5): { text: string; size: number } {
  let s = size;
  while (s > min && m.width(text, s, bold) > maxWidth) s -= 0.25;
  if (m.width(text, s, bold) <= maxWidth) return { text, size: s };
  let cut = text;
  while (cut.length > 1 && m.width(`${cut}...`, s, bold) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}...`, size: s };
}

/** Splits text into lines no wider than maxWidth. */
function wrap(m: Measure, text: string, maxWidth: number, size: number, bold: boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (m.width(next, size, bold) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Lays out one bill inside its box. Returns everything to draw. */
export function layoutBill(header: PrintHeader, bill: PrintBill, box: Box, m: Measure): Op[] {
  const ops: Op[] = [];
  const pad = 16;
  const left = box.x + pad;
  const right = box.x + box.width - pad;
  const width = right - left;
  const top = box.y + box.height - 14;
  const bottom = box.y + 12;
  const text = (t: string, x: number, y: number, size: number, bold = false) => ops.push({ type: 'text', text: t, x, y, size, bold });
  const centered = (t: string, cx: number, y: number, maxWidth: number, size: number, bold: boolean) => {
    const f = fit(m, t, maxWidth, size, bold);
    text(f.text, cx - m.width(f.text, f.size, bold) / 2, y, f.size, bold);
  };
  const rightAligned = (t: string, rx: number, y: number, size: number, bold: boolean) => text(t, rx - m.width(t, size, bold), y, size, bold);

  // ---- Header: logo on the left, the cooperative's details centred beside it.
  const logo = 40;
  ops.push({ type: 'logo', x: left, y: top - logo, size: logo });
  const hx = left + logo + 6;
  const hw = right - hx;
  const hc = hx + hw / 2;
  let y = top - 9;
  const name = wrap(m, header.coopName, hw, 8.2, true);
  if (name.length <= 1) {
    centered(header.coopName, hc, y, hw, 8.2, true);
  } else {
    for (const line of name.slice(0, 2)) {
      centered(line, hc, y, hw, 8.2, true);
      y -= 9;
    }
    y += 9;
  }
  y -= 10;
  centered(header.coopAddress, hc, y, hw, 8.5, true);
  y -= 8;
  if (header.cdaNo) centered(`CDA Reg. No.: ${header.cdaNo}`, hc, y, hw, 6.5, true);
  y -= 6;
  const phoneLine = [header.phone && `Phone No.: ${header.phone}`, header.mobile && `Mobile No.: ${header.mobile}`].filter(Boolean).join('   ');
  if (phoneLine) {
    ops.push({ type: 'rect', x: hx, y: y - 11, width: hw, height: 11 });
    centered(phoneLine, hc, y - 8, hw - 6, 6.2, true);
    y -= 11;
  }
  y = Math.min(y, top - logo) - 17;

  // ---- Title and the account
  text('WATER SERVICE BILLING', left + 6, y, 10.5, true);
  y -= 16;
  const field = (label: string, value: string) => {
    text(label, left + 6, y, 8.3, false);
    const lx = left + 6 + m.width(label, 8.3, false) + 4;
    const f = fit(m, value, right - lx, 8.6, true);
    text(f.text, lx, y, f.size, true);
    y -= 12.5;
  };
  field('Account Name:', bill.accountName);
  field('Account Address/Purok:', bill.address);
  field('Meter No:', bill.meterNo || '');
  y -= 3;

  // ---- Table: MONTH | CONSUMPTION (Cubic Meters) | AMOUNT
  const c1 = left + width * 0.4;
  const c2 = left + width * 0.68;
  const headH = 18;
  const rows = bill.rows;
  // Roomy rows for the usual short bill; tighter ones when many months are owed, so the signatures always fit.
  const rowH = rows.length <= 3 ? 15 : rows.length <= 5 ? 13.5 : rows.length <= 7 ? 12 : 10.5;
  const rowText = rows.length <= 5 ? 8.2 : 7.4;
  const tableTop = y;
  const lineW = 0.6;
  const hline = (yy: number) => ops.push({ type: 'line', x1: left, y1: yy, x2: right, y2: yy, width: lineW });
  hline(tableTop);
  centered('MONTH', (left + c1) / 2, tableTop - 11, c1 - left - 4, 7, true);
  centered('CONSUMPTION', (c1 + c2) / 2, tableTop - 7.5, c2 - c1 - 4, 6.5, true);
  centered('(Cubic Meters)', (c1 + c2) / 2, tableTop - 15, c2 - c1 - 4, 6.2, true);
  centered('AMOUNT', (c2 + right) / 2, tableTop - 11, right - c2 - 4, 7, true);
  let ry = tableTop - headH;
  hline(ry);
  for (const r of rows) {
    const base = ry - rowH / 2 - rowText * 0.35;
    const label = r.withPenalty ? `${r.month} (w/ penalty)` : r.month;
    const f = fit(m, label, c1 - left - 6, rowText, r.kind === 'CURRENT');
    text(f.text, left + 3, base, f.size, r.kind === 'CURRENT');
    if (r.cubicMeters !== null) centered(String(r.cubicMeters), (c1 + c2) / 2, base, c2 - c1 - 4, rowText, false);
    rightAligned(peso(r.amount), right - 3, base, rowText, r.kind === 'CURRENT');
    ry -= rowH;
    hline(ry);
  }
  // TOTAL AMOUNT DUE
  const totalH = rows.length <= 5 ? 16 : 13;
  const totalBase = ry - totalH / 2 - 3;
  text('TOTAL AMOUNT DUE', left + 3, totalBase, 8.4, true);
  rightAligned(peso(bill.totalDue), right - 3, totalBase, 9.2, true);
  ry -= totalH;
  ops.push({ type: 'line', x1: left, y1: ry, x2: right, y2: ry, width: 1.1 });
  // Outer border and column lines (the total row spans the first two columns).
  for (const x of [left, right]) ops.push({ type: 'line', x1: x, y1: tableTop, x2: x, y2: ry, width: lineW });
  ops.push({ type: 'line', x1: c1, y1: tableTop, x2: c1, y2: ry + totalH, width: lineW });
  ops.push({ type: 'line', x1: c2, y1: tableTop, x2: c2, y2: ry, width: lineW });
  y = ry - 13;

  // ---- Note
  text('Note:', left + 6, y, 8.3, true);
  y -= 10.5;
  const notes = [header.dueNote, 'If payment has already been made, please disregard this billing and accept our thanks.'];
  for (const note of notes) {
    const lines = wrap(m, note, width - 22, 7.4, true);
    lines.forEach((line, i) => {
      if (i === 0) text('**', left + 8, y, 7.4, true);
      text(line, left + 18, y, 7.4, true);
      y -= 9;
    });
  }

  // ---- Signatories, anchored to the bottom of the bill.
  const colW = width / 3;
  const sigLine = bottom + 16;
  const sigTop = Math.min(y - 4, sigLine + 22);
  header.signatories.forEach((s, i) => {
    const x0 = left + i * colW + 3;
    const x1 = left + (i + 1) * colW - 3;
    const cx = (x0 + x1) / 2;
    if (s.label) text(s.label, x0, sigTop, 7.4, true);
    ops.push({ type: 'line', x1: x0, y1: sigLine, x2: x1, y2: sigLine, width: 0.6 });
    centered(s.name.toUpperCase(), cx, sigLine - 8, x1 - x0, 6.9, true);
    centered(s.title, cx, sigLine - 16, x1 - x0, 6.9, false);
  });
  return ops;
}

/** Light dotted lines to cut along: one down the middle, one across. */
function cutLines(page: PDFPage, paper: Paper) {
  const { width, height } = PAPER[paper];
  const style = { thickness: 0.5, color: rgb(0.55, 0.55, 0.55), dashArray: [1.5, 3] };
  page.drawLine({ start: { x: width / 2, y: 6 }, end: { x: width / 2, y: height - 6 }, ...style });
  page.drawLine({ start: { x: 6, y: height / 2 }, end: { x: width - 6, y: height / 2 }, ...style });
}

export interface Assets {
  regular: ArrayBuffer | Uint8Array;
  bold: ArrayBuffer | Uint8Array;
  logo: ArrayBuffer | Uint8Array | null;
}

/** Builds the PDF: 4 bills a page, in the order given. */
export async function makeBillsPdf(header: PrintHeader, bills: PrintBill[], assets: Assets, paper: Paper = header.paper): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('Water Service Billing');
  pdf.setCreator('IWMPC Internal System');
  const regular: PDFFont = await pdf.embedFont(assets.regular, { subset: true });
  const bold: PDFFont = await pdf.embedFont(assets.bold, { subset: true });
  const logo: PDFImage | null = assets.logo ? await pdf.embedPng(assets.logo) : null;
  const measure: Measure = { width: (t, size, b) => (b ? bold : regular).widthOfTextAtSize(t, size) };
  const black = rgb(0, 0, 0);

  let page: PDFPage | null = null;
  bills.forEach((bill, i) => {
    const { box } = slotFor(i, paper);
    if (i % BILLS_PER_PAGE === 0) {
      page = pdf.addPage([PAPER[paper].width, PAPER[paper].height]);
      cutLines(page, paper);
    }
    const p = page!;
    for (const op of layoutBill(header, bill, box, measure)) {
      if (op.type === 'text') p.drawText(op.text, { x: op.x, y: op.y, size: op.size, font: op.bold ? bold : regular, color: black });
      else if (op.type === 'line') p.drawLine({ start: { x: op.x1, y: op.y1 }, end: { x: op.x2, y: op.y2 }, thickness: op.width, color: black });
      else if (op.type === 'rect') p.drawRectangle({ x: op.x, y: op.y, width: op.width, height: op.height, borderColor: black, borderWidth: 0.7 });
      else if (op.type === 'logo' && logo) p.drawImage(logo, { x: op.x, y: op.y, width: op.size, height: op.size });
    }
  });
  if (bills.length === 0) pdf.addPage([PAPER[paper].width, PAPER[paper].height]);
  return pdf.save();
}

/** Loads the fonts and the black-and-white logo from the site, once. */
let assetsPromise: Promise<Assets> | null = null;
export function loadAssets(): Promise<Assets> {
  if (!assetsPromise) {
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${url}`);
      return res.arrayBuffer();
    };
    assetsPromise = Promise.all([get('/fonts/LiberationSans-Regular.ttf'), get('/fonts/LiberationSans-Bold.ttf'), get('/logo-bw.png').catch(() => null)])
      .then(([regular, bold, logo]) => ({ regular, bold, logo }))
      .catch((err) => {
        assetsPromise = null;
        throw err;
      });
  }
  return assetsPromise;
}
