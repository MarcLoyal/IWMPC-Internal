import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { BILLS_PER_PAGE, PAPER, layoutBill, layoutNotice, makeBillsPdf, makeNoticesPdf, noticeSlot, pageCount, slotFor, type Box, type Measure, type NoticeHeader, type Op, type PrintBill, type PrintHeader, type Who } from './billPdf';

const pub = (f: string) => readFileSync(resolve(__dirname, '../../public', f));
const assets = { regular: pub('fonts/LiberationSans-Regular.ttf'), bold: pub('fonts/LiberationSans-Bold.ttf'), logo: pub('logo-bw.png') };

const header: PrintHeader = {
  coopName: 'INICBULAN WATERWORKS MULTI-PURPOSE COOPERATIVE',
  coopAddress: 'Inicbulan, Bauan, Batangas',
  cdaNo: '9520-04002341',
  phone: '(043) 740-0767',
  mobile: '0910-4918-512',
  dueNote: 'Due Date until 15th of the Month.',
  paper: 'LETTER',
  signatories: [
    { label: 'Prepared by:', name: 'Alfa M. Mahiya', title: 'Billing Officer' },
    { label: '', name: 'Emard B. Ramos', title: 'Cashier' },
    { label: '', name: 'Marino R. Abanador', title: 'General Manager' },
  ],
};

function bill(i: number, earlier = 0): PrintBill {
  const rows: PrintBill['rows'] = [];
  if (earlier > 5) rows.push({ kind: 'COMBINED', month: 'Jan-Mar 2026', cubicMeters: 66, amount: '1683.30', withPenalty: true });
  for (let e = 0; e < Math.min(earlier, 5); e++) rows.push({ kind: 'EARLIER', month: `Apr 2026`, cubicMeters: 22, amount: '561.66', withPenalty: true });
  rows.push({ kind: 'CURRENT', month: 'Oct 2026', cubicMeters: 23, amount: '535.40', withPenalty: false });
  if (earlier > 5) rows.push({ kind: 'PAYMENT', month: 'Less: payment received', cubicMeters: null, amount: '-200.00', withPenalty: false });
  return {
    form: 'BILL',
    unpaidMonths: 1,
    notice: null,
    billId: i,
    area: 'Almasiga',
    accountName: i === 0 ? 'Maria Clarissa Concepcion Villanueva-Dimaculangan de los Santos' : `Juan Dela Cruz ${i}`,
    address: 'ALMASIGA/GK ECO VILLAGE',
    meterNo: 'Meco # 19-007508',
    period: '2026-10',
    dueDate: '2026-11-15',
    rows,
    totalDue: '535.40',
  };
}

async function measure(): Promise<Measure> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(assets.regular);
  const bold = await pdf.embedFont(assets.bold);
  return { width: (t, s, b) => (b ? bold : regular).widthOfTextAtSize(t, s) };
}

describe('placing bills on pages', () => {
  it('puts 4 bills on a page in a 2 x 2 grid', () => {
    expect([1, 4, 5, 8, 321, 1200].map(pageCount)).toEqual([1, 1, 2, 2, 81, 300]);
    const slots = [0, 1, 2, 3, 4].map((i) => slotFor(i, 'LETTER'));
    expect(slots.map((s) => s.page)).toEqual([0, 0, 0, 0, 1]);
    expect(slots.slice(0, 4).map((s) => [s.box.x, s.box.y])).toEqual([
      [0, 396],
      [306, 396],
      [0, 0],
      [306, 0],
    ]);
    expect(slotFor(3, 'LONG').box).toEqual({ x: 306, y: 0, width: 306, height: 468 });
  });

  it('never lets anything on a bill leave its quarter of the page (so no bill is split)', async () => {
    const m = await measure();
    for (const paper of ['LETTER', 'LONG'] as const) {
      for (const earlier of [0, 1, 5, 8]) {
        for (let i = 0; i < BILLS_PER_PAGE; i++) {
          const { box } = slotFor(i, paper);
          for (const op of layoutBill(header, bill(i, earlier), box, m)) {
            const [x0, y0, x1, y1] =
              op.type === 'text'
                ? [op.x, op.y - op.size * 0.25, op.x + m.width(op.text, op.size, op.bold), op.y + op.size]
                : op.type === 'line'
                  ? [Math.min(op.x1, op.x2), Math.min(op.y1, op.y2), Math.max(op.x1, op.x2), Math.max(op.y1, op.y2)]
                  : op.type === 'rect'
                    ? [op.x, op.y, op.x + op.width, op.y + op.height]
                    : [op.x, op.y, op.x + op.size, op.y + op.size];
            expect(x0).toBeGreaterThanOrEqual(box.x + 4);
            expect(x1).toBeLessThanOrEqual(box.x + box.width - 4);
            expect(y0).toBeGreaterThanOrEqual(box.y + 4);
            expect(y1).toBeLessThanOrEqual(box.y + box.height - 4);
          }
          // The table and note end above the signatures.
          const ops = layoutBill(header, bill(i, earlier), box, m);
          const note = ops.filter((o) => o.type === 'text' && o.text.startsWith('If payment')).pop();
          const sig = ops.find((o) => o.type === 'text' && o.text === 'Prepared by:');
          expect(note && sig && note.type === 'text' && sig.type === 'text' && note.y > sig.y + 6).toBe(true);
        }
      }
    }
  });

  it('prints the settings: names, titles, phone line and due note', async () => {
    const m = await measure();
    const custom = {
      ...header,
      mobile: '0917-000-1111',
      dueNote: 'Due Date until 10th of the Month.',
      signatories: [{ label: 'Prepared by:', name: 'Rosa B. Cruz', title: 'Billing Officer' }, header.signatories[1], { ...header.signatories[2], title: 'Manager' }],
    };
    const texts = layoutBill(custom, bill(5), slotFor(0, 'LETTER').box, m)
      .filter((o) => o.type === 'text')
      .map((o) => (o.type === 'text' ? o.text : ''));
    expect(texts).toEqual(
      expect.arrayContaining([
        'WATER SERVICE BILLING',
        'Phone No.: (043) 740-0767   Mobile No.: 0910-4918-512'.replace('0910-4918-512', '0917-000-1111'),
        'Due Date until 10th of the Month.',
        'ROSA B. CRUZ',
        'Manager',
        'Juan Dela Cruz 5',
        'ALMASIGA/GK ECO VILLAGE',
        'Meco # 19-007508',
        'TOTAL AMOUNT DUE',
        '₱535.40',
      ]),
    );
  });
});

describe('the PDF file', () => {
  it('has the right number of pages', async () => {
    for (const [n, pages] of [
      [1, 1],
      [4, 1],
      [5, 2],
      [9, 3],
    ]) {
      const bytes = await makeBillsPdf(header, Array.from({ length: n }, (_, i) => bill(i, i % 3)), assets);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(pages);
      expect(doc.getPage(0).getSize()).toEqual(PAPER.LETTER);
    }
    const long = await PDFDocument.load(await makeBillsPdf({ ...header, paper: 'LONG' }, [bill(1)], assets));
    expect(long.getPage(0).getSize()).toEqual(PAPER.LONG);
  });
});

// ---- signatures and the 2-month notice -----------------------------------------------------------

const noticeHeader: NoticeHeader = {
  coopName: 'INICBULAN WATERWORKS MULTI-PURPOSE COOPERATIVE',
  coopAddress: 'Inicbulan, Bauan, Batangas',
  cdaNo: '9520-04002341',
  phoneLine: 'Tel. No. 043 740-0767   Mobile No. +63910 491 8512',
  penaltyLabel: 'PENALTY (10%)',
  reconnectionFee: '1000.00',
  thresholdMonths: 2,
  perPage: 1,
  paper: 'LETTER',
  signatories: [
    { label: 'Prepared by:', name: 'Maria B. Ilagan', title: 'Billing Officer' },
    { label: '', name: 'Emard B. Ramos', title: 'Cashier/Collector' },
    { label: '', name: 'Marino R. Abanador', title: 'General Manager' },
  ],
};

function noticeBill(rows: number): PrintBill {
  const r = Array.from({ length: rows }, (_, i) => ({ month: i === 0 && rows > 6 ? 'Jan-Mar 2026' : `Sep 2026`, cubicMeters: 22, amount: '510.60', penalty: '51.06', total: '561.66' }));
  return {
    ...bill(1),
    form: 'NOTICE',
    unpaidMonths: rows,
    notice: { rows: r, totals: { amount: '1021.20', penalty: '102.12', total: '1123.32' }, dueDate: '2026-11-15', disconnectionDate: '2026-11-20' },
  };
}

const bounds = (op: Op, m: Measure) =>
  op.type === 'text'
    ? [op.x, op.y - op.size * 0.25, op.x + m.width(op.text, op.size, op.bold), op.y + op.size]
    : op.type === 'line'
      ? [Math.min(op.x1, op.x2), Math.min(op.y1, op.y2), Math.max(op.x1, op.x2), Math.max(op.y1, op.y2)]
      : op.type === 'logo'
        ? [op.x, op.y, op.x + op.size, op.y + op.size]
        : [op.x, op.y, op.x + op.width, op.y + op.height];

function inside(ops: Op[], box: Box, m: Measure) {
  for (const op of ops) {
    const [x0, y0, x1, y1] = bounds(op, m);
    expect(x0).toBeGreaterThanOrEqual(box.x + 4);
    expect(x1).toBeLessThanOrEqual(box.x + box.width - 4);
    expect(y0).toBeGreaterThanOrEqual(box.y + 4);
    expect(y1).toBeLessThanOrEqual(box.y + box.height - 4);
  }
}

const ALL: ReadonlySet<Who> = new Set(['preparer', 'cashier', 'manager']);

describe('signatures', () => {
  it('sit on each signature line when there is an image, and leave a blank line when there is none', async () => {
    const m = await measure();
    const box = slotFor(0, 'LETTER').box;
    const none = layoutBill(header, bill(1), box, m);
    expect(none.filter((o) => o.type === 'signature')).toEqual([]);
    expect(none.filter((o) => o.type === 'line' && o.y1 === o.y2 && o.x2 - o.x1 < 100)).toHaveLength(3);

    const some = layoutBill(header, bill(1, 8), box, m, new Set<Who>(['preparer', 'manager']));
    const sigs = some.filter((o): o is Extract<Op, { type: 'signature' }> => o.type === 'signature');
    expect(sigs.map((o) => o.who)).toEqual(['preparer', 'manager']);
    inside(some, box, m);
    // Above the name, below "Prepared by:".
    const label = some.find((o) => o.type === 'text' && o.text === 'Prepared by:');
    const name = some.find((o) => o.type === 'text' && o.text === 'ALFA M. MAHIYA');
    expect(label && name && label.type === 'text' && name.type === 'text' && sigs[0].y + sigs[0].height <= label.y && sigs[0].y > name.y).toBe(true);
  });

  it('are drawn into the PDF only when given', async () => {
    const images = (bytes: Uint8Array) => (Buffer.from(bytes).toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
    const sig = pub('logo-bw.png');
    expect(images(await makeBillsPdf(header, [bill(1)], assets))).toBe(1);
    expect(images(await makeBillsPdf(header, [bill(1)], assets, 'LETTER', { preparer: sig, cashier: sig }))).toBe(3);
    expect(images(await makeNoticesPdf(noticeHeader, [noticeBill(2)], assets, 'LETTER', { manager: sig }))).toBe(2);
  });
});

describe('the 2-month notice', () => {
  it('fits its page, 1 per page (landscape) or 2 per page, with few or many months', async () => {
    const m = await measure();
    for (const paper of ['LETTER', 'LONG'] as const) {
      for (const perPage of [1, 2] as const) {
        for (const rows of [2, 6, perPage === 1 ? 12 : 6]) {
          for (const i of [0, 1]) {
            const { box } = noticeSlot(i, perPage, paper);
            const ops = layoutNotice({ ...noticeHeader, perPage }, noticeBill(rows), box, m, ALL);
            inside(ops, box, m);
            const lastNote = ops.filter((o) => o.type === 'text' && o.text.startsWith('If payment')).pop();
            const label = ops.find((o) => o.type === 'text' && o.text === 'Prepared by:');
            expect(lastNote && label && lastNote.type === 'text' && label.type === 'text' && lastNote.y > label.y).toBe(true);
          }
        }
      }
    }
  });

  it('shows the columns, the dates, the notes and the signatories from Settings', async () => {
    const m = await measure();
    const texts = layoutNotice({ ...noticeHeader, reconnectionFee: '1500.00', thresholdMonths: 3 }, noticeBill(2), noticeSlot(0, 1, 'LETTER').box, m)
      .filter((o): o is Extract<Op, { type: 'text' }> => o.type === 'text')
      .map((o) => o.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'WATER SERVICE BILLING',
        'Tel. No. 043 740-0767   Mobile No. +63910 491 8512',
        'MONTH',
        'CONSUMPTION',
        '(cubic meters)',
        'AMOUNT',
        'w/o PENALTY',
        'PENALTY (10%)',
        'TOTAL AMOUNT',
        '**DUE DATE (NO PENALTY)',
        'November 15, 2026',
        '*** DISCONNECTION DATE',
        'November 20, 2026',
        '₱1,123.32',
        'MARIA B. ILAGAN',
        'Cashier/Collector',
      ]),
    );
    expect(texts.join(' ')).toContain('Three months of no payments shall be subject for disconnection');
    expect(texts.join(' ')).toContain('RECONNECTION FEE will be imposed (PHP 1,500.00)');
  });

  it('makes the right number of pages', async () => {
    const one = await PDFDocument.load(await makeNoticesPdf(noticeHeader, [noticeBill(2), noticeBill(3), noticeBill(2)], assets));
    expect(one.getPageCount()).toBe(3);
    expect(one.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
    const two = await PDFDocument.load(await makeNoticesPdf({ ...noticeHeader, perPage: 2 }, [noticeBill(2), noticeBill(3), noticeBill(2)], assets, 'LONG'));
    expect(two.getPageCount()).toBe(2);
    expect(two.getPage(0).getSize()).toEqual(PAPER.LONG);
  });
});
