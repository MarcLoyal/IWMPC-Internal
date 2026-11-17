import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { BILLS_PER_PAGE, PAPER, layoutBill, makeBillsPdf, pageCount, slotFor, type Measure, type PrintBill, type PrintHeader } from './billPdf';

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
