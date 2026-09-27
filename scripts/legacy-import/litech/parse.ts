/**
 * LITECH markazining Google Sheet jurnalini (xlsx) o'qiydi.
 *
 * Varaq tuzilishi (har bir o'qituvchi + kun turi uchun alohida varaq):
 * - har oy 26 ustunlik blok (A / AA / BA / CA), 2-qatorda oy nomi;
 * - 3-qatorda dars sanalari (blok ichida 6..19-ustunlar);
 * - guruh sarlavhasi: X = '$', Y = oylik narx (ming so'm), V = xona;
 * - o'quvchi qatori: C ism, D tug'ilgan yil, E/F telefon, davomat, U imtihon,
 *   V izoh, W bonus, X jarima, Y kvitansiya, Z to'langan summa (ming so'm);
 * - blok oxirida JAMI: Y = 'Mentor'/'Markaz', X = o'qituvchi ulushi, Z = jami.
 */
import * as ExcelJS from 'exceljs';

export const MONTH_KEYS: Record<string, string> = {
  IYUN: '2026-06',
  IYUL: '2026-07',
  AVGUST: '2026-08',
  SENTABR: '2026-09',
};

const BLOCK = 26;

export type Mark = 0 | 1 | 2 | 5;

export interface RawStudentRow {
  row: number;
  name: string;
  birth: string | null;
  phones: string[]; // 9 xonali raqamlar
  phoneRaw: string | null;
  phone2Raw: string | null;
  marks: Record<string, Mark>; // YYYY-MM-DD -> belgi
  dashDates: string[]; // '-' qo'yilgan sanalar (guruhda yo'q)
  exam: string | null;
  note: string | null;
  bonus: string | null;
  fine: string | null;
  receipt: string | null;
  sum: number | null; // ming so'm
}

export interface RawGroupMonth {
  sheet: string;
  month: string; // YYYY-MM
  headerRow: number;
  name: string | null;
  startRaw: string | null;
  time: string | null;
  room: string | null;
  price: number | null; // ming so'm
  lessonDates: string[];
  rows: RawStudentRow[];
}

export interface RawBlockFooter {
  sheet: string;
  month: string;
  course: string | null;
  mentor: number | null;
  total: number | null;
}

export interface RawLead {
  source: 'LIDLAR' | 'Qabulxona';
  row: number;
  name: string | null;
  birth: string | null;
  phones: string[];
  registeredAt: string | null;
  school: string | null;
  heardFrom: string | null;
  course: string | null;
  days: string | null;
  time: string | null;
  status: string | null;
  note: string | null;
}

export interface ParsedWorkbook {
  groupMonths: RawGroupMonth[];
  footers: RawBlockFooter[];
  leads: RawLead[];
  sheetMonths: Record<string, string[]>;
}

const SKIP_SHEETS = new Set([
  'DEMO',
  'SETTINGS',
  'TOOLS',
  'Paramatrlar',
  'DARS JADVALI nusxasi',
  'Qabulxona',
  'LIDLAR',
  'NOMER BAZA',
]);

function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o) return cellValue(o.richText.map((t) => t.text).join(''));
    if ('text' in o) return cellValue(o.text);
    return null;
  }
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  }
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

const str = (v: string | number | null) => (v == null ? null : String(v));

export function extractPhones(...values: (string | number | null)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v == null) continue;
    // "90-026-19-83 88-808-21-03" kabi bitta katakda ikki raqam bo'lishi mumkin:
    // raqam ketma-ketligini olib, 9 xonali bo'laklarga bo'lamiz.
    for (const run of String(v).match(/\d[\d\s\-()]*\d/g) ?? []) {
      let digits = run.replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('998')) digits = digits.slice(3);
      if (digits.length >= 9 && digits.length % 9 === 0) {
        for (let i = 0; i < digits.length; i += 9) out.push(digits.slice(i, i + 9));
      } else if (digits.length >= 9) {
        out.push(digits.slice(-9));
      }
    }
  }
  return Array.from(new Set(out));
}

const isTime = (s: unknown) =>
  typeof s === 'string' && /\d{1,2}[:.]\d{2}\s*-?\s*\d{1,2}[:.]\d{2}/.test(s);

function toMark(v: string | number | null): Mark | '-' | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '-') return '-';
  if (s === '1') return 1;
  if (s === '0') return 0;
  if (s === '2') return 2;
  if (s === '5') return 5;
  return null;
}

function toNumber(v: string | number | null): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

function parseTeacherSheet(ws: ExcelJS.Worksheet, out: ParsedWorkbook) {
  const sheet = ws.name.trim();
  const r2 = ws.getRow(2);
  const r3 = ws.getRow(3);
  out.sheetMonths[sheet] = [];

  for (let b = 0; b < 4; b++) {
    const base = b * BLOCK + 1;
    const label = String(cellValue(r2.getCell(base + 1).value) ?? '').toUpperCase();
    const key = Object.keys(MONTH_KEYS).find((k) => label.includes(k));
    if (!key) continue;
    const month = MONTH_KEYS[key];
    out.sheetMonths[sheet].push(month);

    // Sarlavhadagi sanalar — faqat shu oyga tegishlilari (ba'zi varaqlarda
    // noto'g'ri oy sanasi turibdi) va takrorlanmaganlari.
    const dateCols: { off: number; date: string }[] = [];
    const seen = new Set<string>();
    for (let off = 6; off <= 19; off++) {
      const d = cellValue(r3.getCell(base + off).value);
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month) && !seen.has(d)) {
        seen.add(d);
        dateCols.push({ off, date: d });
      }
    }

    let current: RawGroupMonth | null = null;
    for (let r = 4; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const c = (off: number) => cellValue(row.getCell(base + off).value);

      const marker = c(24);
      if (marker === 'Mentor' || marker === 'Markaz') {
        if (marker === 'Mentor') {
          out.footers.push({
            sheet,
            month,
            course: str(c(2)),
            mentor: null,
            total: null,
          });
        } else {
          const f = out.footers.find((x) => x.sheet === sheet && x.month === month);
          if (f) {
            f.mentor = toNumber(c(23));
            f.total = toNumber(c(25));
          }
        }
        current = null;
        continue;
      }

      const lessonCells = dateCols.map((d) => c(d.off));
      const allCells = Array.from({ length: 14 }, (_, i) => c(6 + i));
      // '$' odatda X da, narx Y da; ba'zi bloklarda bir ustun o'ngga surilgan.
      const dollarShift = c(23) === '$' ? 0 : c(24) === '$' ? 1 : null;
      const isHeader = dollarShift != null || c(3) === 'Start' || allCells.some(isTime);
      if (isHeader) {
        current = {
          sheet,
          month,
          headerRow: r,
          name: str(c(2)),
          startRaw: str(c(4)),
          time: (allCells.find(isTime) as string) ?? null,
          room: str(c(21)),
          price: toNumber(c(24 + (dollarShift ?? 0))),
          lessonDates: dateCols.map((d) => d.date),
          rows: [],
        };
        out.groupMonths.push(current);
        continue;
      }

      const phones = extractPhones(c(4), c(5));
      const sum = toNumber(c(25));
      const hasMarks = lessonCells.some((v) => toMark(v) != null && toMark(v) !== '-');
      let name = str(c(2));
      if (!current || (name && /^\d+$/.test(name))) continue;
      if (!name) {
        // Ismi yozilmagan, lekin puli yoki davomati bor qator — tashlab yubormaymiz
        if (!(sum && sum > 0) && !hasMarks) continue;
        name = `Ismsiz ${phones[0] ?? `(${sheet} ${r}-qator)`}`;
      }

      const marks: Record<string, Mark> = {};
      const dashDates: string[] = [];
      dateCols.forEach((d, i) => {
        const m = toMark(lessonCells[i]);
        if (m === '-') dashDates.push(d.date);
        else if (m != null) marks[d.date] = m;
      });

      current.rows.push({
        row: r,
        name,
        birth: str(c(3)),
        phones,
        phoneRaw: str(c(4)),
        phone2Raw: str(c(5)),
        marks,
        dashDates,
        exam: str(c(20)),
        note: str(c(21)),
        bonus: str(c(22)),
        fine: str(c(23)),
        receipt: str(c(24)),
        sum,
      });
    }
  }
}

function parseLeads(ws: ExcelJS.Worksheet, source: RawLead['source'], out: ParsedWorkbook) {
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const c = (col: number) => cellValue(row.getCell(col).value);
    const name = str(c(2));
    if (source === 'LIDLAR') {
      // LIDLAR: C = telefon (sarlavhada "Tug'ilgan yili" deb yozilgan), D = 2-telefon
      const phones = extractPhones(c(3), c(4), c(5));
      if (!name && !phones.length) return;
      out.leads.push({
        source,
        row: r,
        name,
        birth: null,
        phones,
        registeredAt: str(c(7)),
        school: str(c(6)),
        heardFrom: null,
        course: str(c(8)),
        days: str(c(9)),
        time: str(c(10)),
        status: str(c(11)),
        note: str(c(12)),
      });
    } else {
      const phones = extractPhones(c(4), c(5));
      if (!name && !phones.length) return;
      out.leads.push({
        source,
        row: r,
        name,
        birth: str(c(3)),
        phones,
        registeredAt: str(c(6)),
        school: null,
        heardFrom: str(c(7)),
        course: str(c(8)),
        days: str(c(9)),
        time: str(c(10)),
        status: str(c(11)),
        note: str(c(12)),
      });
    }
  });
}

export async function parseWorkbook(file: string): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out: ParsedWorkbook = { groupMonths: [], footers: [], leads: [], sheetMonths: {} };
  wb.eachSheet((ws) => {
    if (ws.name === 'LIDLAR') return parseLeads(ws, 'LIDLAR', out);
    if (ws.name === 'Qabulxona') return parseLeads(ws, 'Qabulxona', out);
    if (SKIP_SHEETS.has(ws.name) || ws.state !== 'visible') return;
    parseTeacherSheet(ws, out);
  });
  return out;
}
