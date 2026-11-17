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

export interface NoticeRow {
  month: string;
  cubicMeters: number;
  amount: string;
  penalty: string;
  total: string;
}

export interface PrintBill {
  form: 'BILL' | 'NOTICE';
  unpaidMonths: number;
  notice: {
    rows: NoticeRow[];
    totals: { amount: string; penalty: string; total: string };
    dueDate: string;
    disconnectionDate: string;
  } | null;
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

export interface NoticeHeader {
  coopName: string;
  coopAddress: string;
  cdaNo: string;
  phoneLine: string;
  penaltyLabel: string;
  reconnectionFee: string;
  thresholdMonths: number;
  perPage: 1 | 2;
  paper: 'LETTER' | 'LONG';
  signatories: { name: string; title: string; label: string }[];
}

/** Which signatories have a signature image to print: 'preparer', 'cashier', 'manager'. */
export type Who = 'preparer' | 'cashier' | 'manager';
export const WHO: Who[] = ['preparer', 'cashier', 'manager'];

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
  | { type: 'logo'; x: number; y: number; size: number }
  /** A signature image, fitted inside this box (keeping its shape), centred, resting on its bottom edge. */
  | { type: 'signature'; who: Who; x: number; y: number; width: number; height: number };

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
export function layoutBill(header: PrintHeader, bill: PrintBill, box: Box, m: Measure, signed: ReadonlySet<Who> = new Set()): Op[] {
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
    // The signature sits on the line, like a real one, below "Prepared by:", clear of the printed name.
    const sigBottom = sigLine - 1;
    const sigRoof = (s.label ? sigTop - 3 : y - 2) - sigBottom;
    if (signed.has(WHO[i]) && sigRoof >= 10) {
      ops.push({ type: 'signature', who: WHO[i], x: x0 + 2, y: sigBottom, width: x1 - x0 - 4, height: Math.min(26, sigRoof) });
    }
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

/** "Two", "Three", ... for the notice's note. */
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Where notice number `index` goes: 1 per page (landscape) or 2 per page (one above the other). */
export function noticeSlot(index: number, perPage: 1 | 2, paper: Paper): { page: number; box: Box; pageSize: { width: number; height: number } } {
  const p = PAPER[paper];
  if (perPage === 1) {
    return { page: index, box: { x: 0, y: 0, width: p.height, height: p.width }, pageSize: { width: p.height, height: p.width } };
  }
  const half = p.height / 2;
  return { page: Math.floor(index / 2), box: { x: 0, y: index % 2 === 0 ? half : 0, width: p.width, height: half }, pageSize: { width: p.width, height: p.height } };
}

/**
 * Lays out the 2-month unpaid notice, matching IWMPC's landscape form. Sizes scale with the box,
 * so the same design works for a full landscape page or half a page.
 */
export function layoutNotice(header: NoticeHeader, bill: PrintBill, box: Box, m: Measure, signed: ReadonlySet<Who> = new Set()): Op[] {
  const n = bill.notice!;
  const ops: Op[] = [];
  // Full size on a landscape page; a little smaller on half a page (2 per page), using its spare room.
  const k = Math.min(box.height / 520, box.width / 792, 1);
  const s = (v: number) => v * k;
  const pad = s(42);
  const left = box.x + pad;
  const right = box.x + box.width - pad;
  const width = right - left;
  const top = box.y + box.height - s(30);
  const bottom = box.y + s(24);
  const text = (t: string, x: number, y: number, size: number, bold = false) => ops.push({ type: 'text', text: t, x, y, size, bold });
  const centered = (t: string, cx: number, y: number, maxWidth: number, size: number, bold: boolean) => {
    const f = fit(m, t, maxWidth, size, bold, 4);
    text(f.text, cx - m.width(f.text, f.size, bold) / 2, y, f.size, bold);
  };
  const rightAligned = (t: string, rx: number, y: number, size: number, bold: boolean) => text(t, rx - m.width(t, size, bold), y, size, bold);

  // ---- Header: logo on the left, the cooperative's details centred.
  const logo = s(70);
  ops.push({ type: 'logo', x: left, y: top - logo, size: logo });
  const hx = left + logo + s(10);
  const hw = right - hx - logo * 0.4;
  const hc = hx + hw / 2;
  let y = top - s(18);
  centered(header.coopName, hc, y, hw, s(19), true);
  y -= s(17);
  centered(header.coopAddress, hc, y, hw, s(13), true);
  y -= s(12);
  if (header.cdaNo) centered(`CDA Reg. No.: ${header.cdaNo}`, hc, y, hw, s(8.5), true);
  y -= s(11);
  if (header.phoneLine) centered(header.phoneLine, hc, y, hw, s(8.5), false);
  y = Math.min(y, top - logo) - s(20);

  // ---- Title and the account
  text('WATER SERVICE BILLING', left, y, s(12), true);
  y -= s(17);
  const field = (label: string, value: string) => {
    text(label, left + s(8), y, s(9.5), false);
    const lx = left + s(8) + s(118);
    const f = fit(m, value, right - lx, s(10), true, 4);
    text(f.text, lx, y, f.size, true);
    ops.push({ type: 'line', x1: lx, y1: y - s(2.5), x2: left + width * 0.62, y2: y - s(2.5), width: 0.4 });
    y -= s(14);
  };
  field('Account Name:', bill.accountName);
  field('Account Address:', bill.address);
  field('Meter No:', bill.meterNo || '');
  y -= s(4);

  // ---- Table: MONTH | CONSUMPTION | AMOUNT w/o PENALTY | PENALTY | TOTAL AMOUNT
  const cols = [0, 0.2, 0.38, 0.58, 0.76, 1].map((f) => left + width * f);
  const headH = s(30);
  const rows = n.rows;
  const rowH = rows.length <= 6 ? s(17) : rows.length <= 9 ? s(14) : s(12);
  const rowText = rows.length <= 9 ? s(9.5) : s(8.5);
  const lineW = 0.7;
  const tableTop = y;
  const hline = (yy: number, w = lineW) => ops.push({ type: 'line', x1: left, y1: yy, x2: right, y2: yy, width: w });
  hline(tableTop);
  const heads: [string, string][] = [
    ['MONTH', ''],
    ['CONSUMPTION', '(cubic meters)'],
    ['AMOUNT', 'w/o PENALTY'],
    [header.penaltyLabel, ''],
    ['TOTAL AMOUNT', ''],
  ];
  heads.forEach(([a, b], i) => {
    const cx = (cols[i] + cols[i + 1]) / 2;
    const w = cols[i + 1] - cols[i] - s(6);
    if (b) {
      centered(a, cx, tableTop - s(12), w, s(8.5), true);
      centered(b, cx, tableTop - s(23), w, s(8), true);
    } else centered(a, cx, tableTop - s(18), w, s(8.5), true);
  });
  let ry = tableTop - headH;
  hline(ry);
  for (const r of rows) {
    const base = ry - rowH / 2 - rowText * 0.35;
    const f = fit(m, r.month, cols[1] - cols[0] - s(8), rowText, false, 4);
    text(f.text, cols[0] + s(5), base, f.size, false);
    centered(String(r.cubicMeters), (cols[1] + cols[2]) / 2, base, cols[2] - cols[1], rowText, false);
    rightAligned(peso(r.amount), cols[3] - s(6), base, rowText, false);
    rightAligned(peso(r.penalty), cols[4] - s(6), base, rowText, false);
    rightAligned(peso(r.total), cols[5] - s(6), base, rowText, true);
    ry -= rowH;
    hline(ry);
  }
  const totalH = s(18);
  const tb = ry - totalH / 2 - s(3.5);
  text('TOTAL', cols[0] + s(5), tb, s(10), true);
  rightAligned(peso(n.totals.amount), cols[3] - s(6), tb, s(10), true);
  rightAligned(peso(n.totals.penalty), cols[4] - s(6), tb, s(10), true);
  rightAligned(peso(n.totals.total), cols[5] - s(6), tb, s(11), true);
  ry -= totalH;
  hline(ry, 1.4);
  for (const x of cols) ops.push({ type: 'line', x1: x, y1: tableTop, x2: x, y2: ry, width: x === cols[0] || x === cols[5] ? lineW : lineW * 0.8 });
  y = ry - s(20);

  // ---- The two date boxes
  const boxW = s(150);
  const boxH = s(17);
  const dateBox = (label: string, value: string) => {
    text(label, left, y, s(9.5), true);
    const bx = left + s(190);
    ops.push({ type: 'rect', x: bx, y: y - s(5), width: boxW, height: boxH });
    centered(value, bx + boxW / 2, y, boxW - s(6), s(10), true);
    y -= s(22);
  };
  dateBox('**DUE DATE (NO PENALTY)', longDate(n.dueDate));
  dateBox('*** DISCONNECTION DATE', longDate(n.disconnectionDate));
  y -= s(2);

  // ---- Notes
  const notes: [string, string][] = [
    ['****', `${NUMBER_WORDS[header.thresholdMonths] ?? header.thresholdMonths} months of no payments shall be subject for disconnection without prior notice.`],
    ['*****', `Once disconnected, a RECONNECTION FEE will be imposed (PHP ${Number(header.reconnectionFee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`],
    ['******', 'If payment has already been made, please disregard this billing and accept our thanks.'],
  ];
  for (const [mark, note] of notes) {
    const lines = wrap(m, note, width - s(50), s(9), true);
    lines.forEach((line, i) => {
      if (i === 0) text(mark, left, y, s(9), true);
      text(line, left + s(42), y, s(9), true);
      y -= s(11.5);
    });
  }

  // ---- Signatories, anchored to the bottom.
  const colW = width / 3;
  const sigLine = bottom + s(22);
  const labelY = Math.min(y - s(4), sigLine + s(38));
  header.signatories.forEach((sg, i) => {
    const x0 = left + i * colW + s(8);
    const x1 = left + (i + 1) * colW - s(8);
    const cx = (x0 + x1) / 2;
    if (sg.label) text(sg.label, x0, labelY, s(9.5), true);
    const sigBottom = sigLine - s(1.5);
    const roof = (sg.label ? labelY - s(4) : y - s(2)) - sigBottom;
    if (signed.has(WHO[i]) && roof >= s(12)) {
      ops.push({ type: 'signature', who: WHO[i], x: x0 + s(10), y: sigBottom, width: x1 - x0 - s(20), height: Math.min(s(40), roof) });
    }
    ops.push({ type: 'line', x1: x0 + s(10), y1: sigLine, x2: x1 - s(10), y2: sigLine, width: 0.7 });
    centered(sg.name.toUpperCase(), cx, sigLine - s(11), x1 - x0, s(9), true);
    centered(sg.title, cx, sigLine - s(21), x1 - x0, s(8.5), false);
  });
  return ops;
}

export interface Assets {
  regular: ArrayBuffer | Uint8Array;
  bold: ArrayBuffer | Uint8Array;
  logo: ArrayBuffer | Uint8Array | null;
}

/** Signature images (PNG bytes) for one form, by signatory. */
export type Signatures = Partial<Record<Who, ArrayBuffer | Uint8Array>>;

async function startPdf(assets: Assets, signatures: Signatures, title: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setCreator('IWMPC Internal System');
  const regular: PDFFont = await pdf.embedFont(assets.regular, { subset: true });
  const bold: PDFFont = await pdf.embedFont(assets.bold, { subset: true });
  const logo: PDFImage | null = assets.logo ? await pdf.embedPng(assets.logo) : null;
  const sigs: Partial<Record<Who, PDFImage>> = {};
  for (const who of WHO) {
    const bytes = signatures[who];
    if (bytes) {
      try {
        sigs[who] = await pdf.embedPng(bytes);
      } catch {
        /* an unreadable image prints as a blank line */
      }
    }
  }
  // Text widths are remembered: the same header, labels and names are measured again and again.
  const widths = new Map<string, number>();
  const measure: Measure = {
    width: (t, size, b) => {
      const key = `${b ? 1 : 0}|${size}|${t}`;
      let w = widths.get(key);
      if (w === undefined) {
        w = (b ? bold : regular).widthOfTextAtSize(t, size);
        widths.set(key, w);
      }
      return w;
    },
  };
  const black = rgb(0, 0, 0);
  const draw = (page: PDFPage, ops: Op[]) => {
    for (const op of ops) {
      if (op.type === 'text') page.drawText(op.text, { x: op.x, y: op.y, size: op.size, font: op.bold ? bold : regular, color: black });
      else if (op.type === 'line') page.drawLine({ start: { x: op.x1, y: op.y1 }, end: { x: op.x2, y: op.y2 }, thickness: op.width, color: black });
      else if (op.type === 'rect') page.drawRectangle({ x: op.x, y: op.y, width: op.width, height: op.height, borderColor: black, borderWidth: 0.7 });
      else if (op.type === 'logo' && logo) page.drawImage(logo, { x: op.x, y: op.y, width: op.size, height: op.size });
      else if (op.type === 'signature' && sigs[op.who]) {
        const img = sigs[op.who]!;
        const scale = Math.min(op.width / img.width, op.height / img.height);
        const w = img.width * scale;
        page.drawImage(img, { x: op.x + (op.width - w) / 2, y: op.y, width: w, height: img.height * scale });
      }
    }
  };
  const signed = new Set(WHO.filter((w) => sigs[w]));
  return { pdf, measure, draw, signed };
}

/** Builds the monthly bills PDF: 4 bills a page, in the order given. */
export async function makeBillsPdf(header: PrintHeader, bills: PrintBill[], assets: Assets, paper: Paper = header.paper, signatures: Signatures = {}): Promise<Uint8Array> {
  const { pdf, measure, draw, signed } = await startPdf(assets, signatures, 'Water Service Billing');
  let page: PDFPage | null = null;
  bills.forEach((bill, i) => {
    const { box } = slotFor(i, paper);
    if (i % BILLS_PER_PAGE === 0) {
      page = pdf.addPage([PAPER[paper].width, PAPER[paper].height]);
      cutLines(page, paper);
    }
    draw(page!, layoutBill(header, bill, box, measure, signed));
  });
  if (bills.length === 0) pdf.addPage([PAPER[paper].width, PAPER[paper].height]);
  return pdf.save();
}

/** Builds the 2-month notices PDF: 1 per page (landscape) or 2 per page. */
export async function makeNoticesPdf(header: NoticeHeader, bills: PrintBill[], assets: Assets, paper: Paper = header.paper, signatures: Signatures = {}): Promise<Uint8Array> {
  const { pdf, measure, draw, signed } = await startPdf(assets, signatures, 'Water Service Billing - Notice');
  let page: PDFPage | null = null;
  bills.forEach((bill, i) => {
    const { box, pageSize } = noticeSlot(i, header.perPage, paper);
    if (i % header.perPage === 0) {
      page = pdf.addPage([pageSize.width, pageSize.height]);
      if (header.perPage === 2) {
        page.drawLine({ start: { x: 6, y: pageSize.height / 2 }, end: { x: pageSize.width - 6, y: pageSize.height / 2 }, thickness: 0.5, color: rgb(0.55, 0.55, 0.55), dashArray: [1.5, 3] });
      }
    }
    draw(page!, layoutNotice(header, bill, box, measure, signed));
  });
  if (bills.length === 0) pdf.addPage([PAPER[paper].height, PAPER[paper].width]);
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
