/**
 * Xom jurnal (parse.ts) -> tizim modeli: o'qituvchilar, guruhlar (oylar
 * bo'yicha zanjir), o'quvchilar (takrorlar birlashtirilgan), a'zolik oynalari,
 * to'lovlar va davomat. Bazaga tegmaydi — dry-run shu yerda tugaydi.
 */
import {
  Mark,
  ParsedWorkbook,
  RawGroupMonth,
  RawLead,
  RawStudentRow,
} from './parse';

export const FIRST_MONTH = '2026-06';
export const LAST_MONTH = '2026-09';
/** Sentabr ro'yxatida bor, lekin hali birorta darsga kelmagan o'quvchilar shu sanadan a'zo bo'ladi. */
export const PENDING_JOIN = '2026-10-01';
/** Kvitansiya o'rnidagi bu so'zlar — o'sha oy tekin o'qigan (foydalanuvchi tasdiqlagan). */
export const FREE_CODES = new Set(['proba', 'baza', 'bonus', 'ehson']);

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

const TEACHERS: Record<string, { firstName: string; lastName: string; course: string }> = {
  Lazizbek: { firstName: 'Lazizbek', lastName: 'Isaqov', course: 'Kompyuter savodxonligi' },
  Feruza: { firstName: 'Feruza', lastName: '', course: 'Ingliz tili' },
  Muslimaxon: { firstName: 'Muslimaxon', lastName: 'Isaqova', course: 'Ingliz tili' },
  Nafisa: { firstName: 'Nafisa', lastName: 'Rahimova', course: 'Kompyuter savodxonligi' },
  Gulchexra: { firstName: 'Gulchexra', lastName: 'Abdumalikova', course: 'Ingliz tili' },
  Umarjon: { firstName: 'Umarjon', lastName: 'Rustamov', course: 'Koreys tili' },
  Durbek: { firstName: 'Durbek', lastName: 'Alisherov', course: 'Koreys tili' },
  Shaxriyor: { firstName: 'Shaxriyor', lastName: '', course: 'Backend' },
  Sevara: { firstName: 'Sevara', lastName: 'Xalitova', course: 'Koreys tili' },
};

const DAYS: Record<string, Weekday[]> = {
  DCHJ: ['monday', 'wednesday', 'friday'],
  SPSH: ['tuesday', 'thursday', 'saturday'],
};

// ── yordamchilar ────────────────────────────────────────────────────────────

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Egizaklarga an'anaviy qo'yiladigan ism juftlari — bular yozuv xatosi emas. */
const TWIN_NAMES = [['hasan', 'husan']];

/**
 * Bitta telefonga yozilgan ikki qator bitta odammi? Telefon oilaniki bo'lgani
 * uchun faqat telefon yetmaydi: tug'ilgan yil farq qilmasligi va ism
 * (familiyadan tashqari) yozuv xatosi darajasida o'xshash bo'lishi kerak.
 */
function samePersonByPhone(a: RawStudentRow, b: RawStudentRow): boolean {
  const na = normName(a.name);
  const nb = normName(b.name);
  if (similarity(na, nb) < 0.8) return false;
  const fa = na.split(' ').slice(1).join(' ');
  const fb = nb.split(' ').slice(1).join(' ');
  const twins = TWIN_NAMES.some(
    ([x, y]) => (fa.startsWith(x) && fb.startsWith(y)) || (fa.startsWith(y) && fb.startsWith(x)),
  );
  if (twins) return false;
  const firstSim = fa && fb ? similarity(fa, fb) : 1;
  // Ism deyarli bir xil (Hikmatilo/Hikmatillo) — tug'ilgan yil xato yozilgan bo'lishi mumkin
  if (firstSim >= 0.85) return true;
  if (firstSim < 0.6) return false; // Muslima / Gulzina — opa-singillar
  const ya = a.birth?.match(/(19|20)\d{2}/)?.[0];
  const yb = b.birth?.match(/(19|20)\d{2}/)?.[0];
  return !(ya && yb && ya !== yb);
}

class UnionFind {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number) {
    this.p[this.find(a)] = this.find(b);
  }
}

const monthStart = (m: string) => `${m}-01`;
function nextMonthStart(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
}
function addDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function parseStartRaw(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseTime(raw: string | null): { start: string; minutes: number } | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[:.](\d{2})\s*-?\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  let e = Number(m[3]) * 60 + Number(m[4]);
  if (e <= s) e += 12 * 60; // "12:00-1:30"
  const minutes = Math.min(240, Math.max(30, e - s));
  return { start: `${m[1].padStart(2, '0')}:${m[2]}`, minutes };
}

function normRoom(raw: string | null): string | null {
  const m = raw?.match(/(\d+)\s*-?\s*xona/i);
  return m ? `${m[1]}-xona` : null;
}

function mode(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

// ── model turlari ───────────────────────────────────────────────────────────

export interface MTeacher {
  key: string;
  firstName: string;
  lastName: string;
}

export interface MStudent {
  idx: number;
  firstName: string;
  lastName: string;
  phone: string;
  secondPhone: string | null;
  notes: string[];
  status: 'ACTIVE' | 'new' | 'stopped' | 'finished';
  activatedAt: string | null;
  stoppedAt: string | null;
  mergedNames: string[];
}

export interface MGroup {
  idx: number;
  sheet: string;
  teacherKey: string;
  subject: string;
  name: string;
  room: string | null;
  days: Weekday[];
  startTime: string;
  lessonMinutes: number;
  startDate: string;
  endDate: string | null;
  status: 'started' | 'finished';
  feeByMonth: Record<string, number>; // YYYY-MM -> so'm
  months: RawGroupMonth[];
}

export interface MEnrollment {
  studentIdx: number;
  groupIdx: number;
  joinedAt: string;
  leftAt: string | null;
  pending: boolean;
}

export interface MPayment {
  studentIdx: number;
  groupIdx: number;
  month: string; // YYYY-MM
  paid: number; // so'm
  free: string | null; // tekin sababi (proba/baza/...)
  receipt: string | null;
  paidAt: string; // YYYY-MM-DD
  fullFee: number;
}

export interface MAttendance {
  studentIdx: number;
  groupIdx: number;
  date: string;
  mark: Mark;
}

export interface MLead extends RawLead {
  matchedStudentIdx: number | null;
}

export interface Model {
  teachers: MTeacher[];
  groups: MGroup[];
  students: MStudent[];
  enrollments: MEnrollment[];
  payments: MPayment[];
  attendance: MAttendance[];
  leads: MLead[];
  warnings: string[];
  footers: ParsedWorkbook['footers'];
}

// ── asosiy quruvchi ─────────────────────────────────────────────────────────

interface RowRef {
  gm: RawGroupMonth;
  row: RawStudentRow;
}

export function buildModel(parsed: ParsedWorkbook): Model {
  const warnings: string[] = [];
  const gms = parsed.groupMonths.filter((g) => g.rows.length > 0);

  // 1) O'quvchilarni birlashtirish
  const refs: RowRef[] = gms.flatMap((gm) => gm.rows.map((row) => ({ gm, row })));
  const uf = new UnionFind(refs.length);
  // Klaster -> qaysi guruh-oylarda qaysi ismlar bilan turibdi. Bitta guruh-oyda
  // yonma-yon turgan ikki xil ism — bu ikki odam (egizaklar, opa-singillar),
  // ularni hech qachon birlashtirmaymiz.
  const gmNames = new Map<number, Map<RawGroupMonth, Set<string>>>();
  refs.forEach((r, i) => gmNames.set(i, new Map([[r.gm, new Set([normName(r.row.name)])]])));
  const tryUnion = (i: number, j: number) => {
    const a = uf.find(i);
    const b = uf.find(j);
    if (a === b) return;
    const ga = gmNames.get(a)!;
    const gb = gmNames.get(b)!;
    for (const [gm, names] of ga) {
      const other = gb.get(gm);
      if (!other) continue;
      if (names.size !== 1 || other.size !== 1 || [...names][0] !== [...other][0]) return;
    }
    uf.union(a, b);
    const root = uf.find(a);
    const merged = new Map(ga);
    for (const [gm, names] of gb) merged.set(gm, new Set([...(merged.get(gm) ?? []), ...names]));
    gmNames.set(root, merged);
  };
  const byName = new Map<string, number>();
  const byPhone = new Map<string, number[]>();
  refs.forEach((r, i) => {
    const n = normName(r.row.name);
    if (byName.has(n)) tryUnion(i, byName.get(n)!);
    else byName.set(n, i);
    for (const p of r.row.phones) {
      const list = byPhone.get(p) ?? [];
      for (const j of list) {
        // Aka-uka/opa-singillar bitta telefonda bo'ladi — ism ham o'xshash bo'lishi shart
        if (samePersonByPhone(r.row, refs[j].row)) tryUnion(i, j);
      }
      list.push(i);
      byPhone.set(p, list);
    }
  });

  const clusters = new Map<number, number[]>();
  refs.forEach((_, i) => {
    const root = uf.find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });

  const students: MStudent[] = [];
  const studentOfRef = new Map<number, number>();
  for (const members of clusters.values()) {
    const idx = students.length;
    members.forEach((m) => studentOfRef.set(m, idx));
    const sorted = [...members].sort((a, b) => refs[a].gm.month.localeCompare(refs[b].gm.month));
    const names = sorted.map((m) => refs[m].row.name.replace(/\s+/g, ' ').trim());
    const nameCounts = new Map<string, number>();
    names.forEach((n) => nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1));
    const best = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const [last, ...rest] = best.split(' ');
    const phones = Array.from(new Set(sorted.slice().reverse().flatMap((m) => refs[m].row.phones)));
    const births = Array.from(
      new Set(sorted.map((m) => refs[m].row.birth).filter((b): b is string => !!b)),
    );
    const notes: string[] = [];
    if (births.length) notes.push(`Tug'ilgan yili: ${births.join(', ')}`);
    const uniqueNames = Array.from(new Set(names));
    if (uniqueNames.length > 1 && uniqueNames.some((n) => normName(n) !== normName(best))) {
      warnings.push(`Birlashtirildi: ${uniqueNames.join(' | ')}`);
    }
    students.push({
      idx,
      firstName: rest.length ? rest.join(' ') : last,
      lastName: rest.length ? last : '',
      phone: phones[0] ? `+998${phones[0]}` : '',
      secondPhone: phones[1] ? `+998${phones[1]}` : null,
      notes,
      status: 'ACTIVE',
      activatedAt: null,
      stoppedAt: null,
      mergedNames: uniqueNames,
    });
  }
  const refIndex = new Map<RawStudentRow, number>();
  refs.forEach((r, i) => refIndex.set(r.row, i));
  const studentOf = (row: RawStudentRow) => studentOfRef.get(refIndex.get(row)!)!;
  const studentSet = (gm: RawGroupMonth) => new Set(gm.rows.map(studentOf));

  // 2) Guruhlarni oylar bo'yicha zanjirga bog'lash.
  // Guruhni NOMI belgilaydi (markaz egasi tasdiqlagan): FRONTEND-1 avgustda 08:00 da,
  // sentabrda maktab boshlanib 08:30 da — bu bitta guruh, vaqti va tarkibi o'zgargan.
  // Nomi bir xil guruhlar avval bog'lanadi (bir varaqda ikkita bir xil nomli bo'lsa —
  // umumiy o'quvchilari ko'prog'i bilan). Nomi yo'q yoki mos kelmaganlar — o'quvchilar
  // bo'yicha (N-1 → KOMP-6 kabi qayta nomlanganlar).
  const next = new Map<RawGroupMonth, RawGroupMonth>();
  const prev = new Map<RawGroupMonth, RawGroupMonth>();
  const sheets = Array.from(new Set(gms.map((g) => g.sheet)));
  const linkPass = (gap: number, byName: boolean) => {
    for (const sheet of sheets) {
      const months = parsed.sheetMonths[sheet];
      for (let i = 0; i + gap < months.length; i++) {
        const A = gms.filter((g) => g.sheet === sheet && g.month === months[i] && !next.has(g));
        const B = gms.filter((g) => g.sheet === sheet && g.month === months[i + gap] && !prev.has(g));
        const cands: { a: RawGroupMonth; b: RawGroupMonth; overlap: number }[] = [];
        for (const a of A) {
          const sa = studentSet(a);
          for (const b of B) {
            const sb = studentSet(b);
            const overlap = [...sa].filter((x) => sb.has(x)).length;
            const nameEq = !!a.name && !!b.name && normName(a.name) === normName(b.name);
            const need = Math.max(1, Math.ceil(0.3 * Math.min(sa.size, sb.size)));
            if (byName ? nameEq : overlap >= need) cands.push({ a, b, overlap });
          }
        }
        cands.sort((x, y) => y.overlap - x.overlap);
        for (const c of cands) {
          if (next.has(c.a) || prev.has(c.b)) continue;
          next.set(c.a, c.b);
          prev.set(c.b, c.a);
        }
      }
    }
  };
  linkPass(1, true);
  linkPass(2, true);
  linkPass(1, false);
  linkPass(2, false);

  const groups: MGroup[] = [];
  const groupOfGm = new Map<RawGroupMonth, number>();
  for (const head of gms.filter((g) => !prev.has(g))) {
    const chain: RawGroupMonth[] = [head];
    while (next.has(chain[chain.length - 1])) chain.push(next.get(chain[chain.length - 1])!);
    const idx = groups.length;
    chain.forEach((g) => groupOfGm.set(g, idx));

    const [teacherKey, dayKey] = head.sheet.split('_');
    const teacher = TEACHERS[teacherKey];
    if (!teacher) throw new Error(`Noma'lum o'qituvchi varag'i: ${head.sheet}`);
    const days = DAYS[dayKey?.trim()] ?? DAYS.DCHJ;
    const last = chain[chain.length - 1];
    const first = chain[0];

    const time = parseTime([...chain].reverse().find((g) => parseTime(g.time))?.time ?? null);
    const room = normRoom([...chain].reverse().find((g) => normRoom(g.room))?.room ?? null);

    // Narx: sarlavhadagi narx; yo'q bo'lsa qo'shni oydan; u ham bo'lmasa to'langan summalar modasi.
    const feeByMonth: Record<string, number> = {};
    const own = chain.map((g) => (g.price && g.price > 0 ? g.price : null));
    chain.forEach((g, i) => {
      let p = own[i];
      for (let k = i - 1; p == null && k >= 0; k--) p = own[k];
      for (let k = i + 1; p == null && k < chain.length; k++) p = own[k];
      if (p == null) p = mode(g.rows.map((r) => r.sum ?? 0).filter((s) => s > 0));
      // Hali null bo'lsa — pastda varaqdagi eng ko'p uchraydigan narx bilan to'ldiriladi
      feeByMonth[g.month] = p == null ? NaN : p * 1000;
    });

    const firstMarked = (g: RawGroupMonth) =>
      g.rows.flatMap((r) => Object.keys(r.marks)).sort()[0] ?? g.lessonDates[0] ?? monthStart(g.month);
    const rawStart = parseStartRaw(first.startRaw);
    let startDate: string;
    if (rawStart && rawStart <= firstMarked(first)) startDate = rawStart;
    else if (first.month === FIRST_MONTH) startDate = monthStart(FIRST_MONTH);
    else startDate = firstMarked(first);

    const finished = last.month < LAST_MONTH;
    const endDate = finished
      ? last.lessonDates[last.lessonDates.length - 1] ?? `${last.month}-28`
      : null;

    const baseName =
      [...chain].reverse().find((g) => g.name)?.name ??
      `${teacher.firstName} ${dayKey} ${time?.start ?? ''}`.trim();

    groups.push({
      idx,
      sheet: head.sheet,
      teacherKey,
      subject: /dizayn/i.test(baseName)
        ? 'Grafik dizayn'
        : /frontend|^fr-/i.test(baseName)
          ? 'Frontend'
          : teacher.course,
      name: baseName,
      room,
      days,
      startTime: time?.start ?? '09:00',
      lessonMinutes: time?.minutes ?? 90,
      startDate,
      endDate,
      status: finished ? 'finished' : 'started',
      feeByMonth,
      months: chain,
    });
  }

  // Narxi umuman topilmagan guruh-oylar: o'sha varaqdagi eng ko'p uchraydigan narx
  for (const g of groups) {
    for (const [m, fee] of Object.entries(g.feeByMonth)) {
      if (!Number.isNaN(fee)) continue;
      const sheetFees = groups
        .filter((o) => o.sheet === g.sheet)
        .flatMap((o) => Object.entries(o.feeByMonth))
        .filter(([, f]) => !Number.isNaN(f) && f > 0);
      const sameMonth = sheetFees.filter(([om]) => om === m).map(([, f]) => f);
      const fallback = mode(sameMonth.length ? sameMonth : sheetFees.map(([, f]) => f)) ?? 0;
      g.feeByMonth[m] = fallback;
      warnings.push(`Narx sheet'da yo'q, varaqdagi odatiy narx qo'yildi: ${g.sheet} ${m} "${g.name}" = ${fallback}`);
    }
  }

  // Bir xil nomli guruhlarni ajratish (masalan ikkita "Pre-inter")
  const MONTH_UZ: Record<string, string> = { '06': 'iyun', '07': 'iyul', '08': 'avg', '09': 'sen' };
  const span = (g: MGroup) => {
    const a = MONTH_UZ[g.months[0].month.slice(5)];
    const b = MONTH_UZ[g.months[g.months.length - 1].month.slice(5)];
    return a === b ? a : `${a}–${b}`;
  };
  const countBy = (key: (g: MGroup) => string) => {
    const m = new Map<string, number>();
    groups.forEach((g) => m.set(key(g), (m.get(key(g)) ?? 0) + 1));
    return m;
  };
  const byBase = countBy((g) => g.name);
  for (const g of groups) if ((byBase.get(g.name) ?? 0) > 1) g.name = `${g.name} ${g.startTime}`;
  const byTimed = countBy((g) => g.name);
  for (const g of groups) if ((byTimed.get(g.name) ?? 0) > 1) g.name = `${g.name} (${span(g)})`;

  // 3) A'zolik oynalari, to'lovlar, davomat
  const enrollments: MEnrollment[] = [];
  const payments: MPayment[] = [];
  const attendance: MAttendance[] = [];
  let ghostRows = 0;

  for (const g of groups) {
    const perStudent = new Map<number, Map<number, RawStudentRow[]>>(); // student -> chainPos -> rows
    g.months.forEach((gm, pos) => {
      for (const row of gm.rows) {
        const s = studentOf(row);
        const m = perStudent.get(s) ?? new Map();
        m.set(pos, [...(m.get(pos) ?? []), row]);
        perStudent.set(s, m);
      }
    });

    for (const [sIdx, byPos] of perStudent) {
      // Bir oyda ikki qator bo'lsa birlashtiramiz
      const merged = new Map<number, { marks: Record<string, Mark>; sum: number; receipt: string | null; rows: RawStudentRow[] }>();
      for (const [pos, rows] of byPos) {
        merged.set(pos, {
          marks: Object.assign({}, ...rows.map((r) => r.marks)),
          sum: rows.reduce((a, r) => a + (r.sum ?? 0), 0),
          receipt: rows.map((r) => r.receipt).find((x) => x) ?? null,
          rows,
        });
      }

      // Hech bir darsda belgisi yo'q va to'lamagan qatorlar — "arvoh" (yoki sentabrda kutilayotgan)
      const lastPos = g.months.length - 1;
      const pendingPositions = new Set<number>();
      for (const [pos, d] of merged) {
        const free = d.receipt && FREE_CODES.has(d.receipt.trim().toLowerCase());
        if (Object.keys(d.marks).length === 0 && d.sum <= 0 && !free) {
          if (pos === lastPos && g.months[pos].month === LAST_MONTH) pendingPositions.add(pos);
          else {
            merged.delete(pos);
            ghostRows++;
          }
        }
      }

      const positions = [...merged.keys()].sort((a, b) => a - b);
      const runs: number[][] = [];
      for (const p of positions) {
        const run = runs[runs.length - 1];
        if (run && run[run.length - 1] === p - 1) run.push(p);
        else runs.push([p]);
      }

      for (const run of runs) {
        const F = run[0];
        const L = run[run.length - 1];
        const gmF = g.months[F];
        const gmL = g.months[L];
        const dF = merged.get(F)!;
        const dL = merged.get(L)!;
        const feeF = g.feeByMonth[gmF.month];
        const feeL = g.feeByMonth[gmL.month];

        if (run.length === 1 && pendingPositions.has(F)) {
          enrollments.push({ studentIdx: sIdx, groupIdx: g.idx, joinedAt: PENDING_JOIN, leftAt: null, pending: true });
          continue;
        }

        const fm = Object.keys(dF.marks).sort()[0];
        let joinedAt: string;
        if (!fm || dF.sum * 1000 >= feeF || fm === gmF.lessonDates[0]) joinedAt = monthStart(gmF.month);
        else joinedAt = fm;
        if (joinedAt < g.startDate) joinedAt = g.startDate;

        let leftAt: string | null = null;
        if (L !== lastPos) {
          const la = Object.entries(dL.marks)
            .filter(([, m]) => m !== 0)
            .map(([d]) => d)
            .sort()
            .pop();
          if (dL.sum * 1000 >= feeL) leftAt = nextMonthStart(gmL.month);
          else if (la) leftAt = addDay(la);
          else leftAt = monthStart(gmL.month);
        }
        if (leftAt && leftAt <= joinedAt) {
          ghostRows++;
          continue;
        }
        enrollments.push({ studentIdx: sIdx, groupIdx: g.idx, joinedAt, leftAt, pending: false });

        for (const pos of run) {
          const gm = g.months[pos];
          const d = merged.get(pos)!;
          if (pendingPositions.has(pos)) continue;
          for (const [date, mark] of Object.entries(d.marks)) {
            if (date < joinedAt || (leftAt && date >= leftAt)) continue;
            attendance.push({ studentIdx: sIdx, groupIdx: g.idx, date, mark });
          }
          const code = d.receipt?.trim().toLowerCase() ?? null;
          const free = code && FREE_CODES.has(code) && d.sum <= 0 ? code : null;
          if (d.sum > 0 || free) {
            const joinedThisMonth = joinedAt.startsWith(gm.month) && Number(joinedAt.slice(8)) > 10;
            payments.push({
              studentIdx: sIdx,
              groupIdx: g.idx,
              month: gm.month,
              paid: Math.round(d.sum * 1000),
              free,
              receipt: d.receipt,
              paidAt: joinedThisMonth ? joinedAt : `${gm.month}-10`,
              fullFee: g.feeByMonth[gm.month],
            });
          }
          // Izoh, bonus, jarima, imtihon — o'quvchi izohiga oyma-oy
          for (const r of d.rows) {
            const parts = [
              r.note && `izoh: ${r.note}`,
              r.bonus && `bonus: ${r.bonus}`,
              r.fine && `jarima: ${r.fine}`,
              r.exam && `imtihon: ${r.exam}`,
            ].filter(Boolean);
            if (parts.length) students[sIdx].notes.push(`[${gm.month} ${g.name}] ${parts.join('; ')}`);
          }
        }
      }
    }
  }
  if (ghostRows) warnings.push(`Belgisiz va to'lovsiz qatorlar tashlab yuborildi: ${ghostRows}`);

  // 4) O'quvchi holati
  for (const s of students) {
    const own = enrollments.filter((e) => e.studentIdx === s.idx);
    const real = own.filter((e) => !e.pending);
    s.activatedAt = real.map((e) => e.joinedAt).sort()[0] ?? null;
    const open = real.filter((e) => !e.leftAt && groups[e.groupIdx].status === 'started');
    if (open.length) s.status = 'ACTIVE';
    else if (!real.length) s.status = own.length ? 'new' : 'stopped';
    else {
      const lastLeft = real.map((e) => e.leftAt ?? groups[e.groupIdx].endDate ?? '').sort().pop()!;
      const endedWithGroup = real.some((e) => !e.leftAt && groups[e.groupIdx].status === 'finished');
      s.status = endedWithGroup ? 'finished' : 'stopped';
      s.stoppedAt = s.status === 'stopped' ? lastLeft : null;
      // Kutilayotgan (sentabr) a'zolik bo'lsa — o'quvchi yangi guruhni kutmoqda
      if (own.some((e) => e.pending)) s.status = 'new';
    }
  }

  // 5) Lidlar
  const phoneToStudent = new Map<string, number>();
  for (const s of students) {
    for (const p of [s.phone, s.secondPhone]) if (p) phoneToStudent.set(p.slice(-9), s.idx);
  }
  const leads: MLead[] = parsed.leads.map((l) => ({
    ...l,
    matchedStudentIdx: l.phones.map((p) => phoneToStudent.get(p)).find((x) => x != null) ?? null,
  }));

  const teachers: MTeacher[] = Array.from(new Set(groups.map((g) => g.teacherKey))).map((key) => ({
    key,
    firstName: TEACHERS[key].firstName,
    lastName: TEACHERS[key].lastName,
  }));

  return { teachers, groups, students, enrollments, payments, attendance, leads, warnings, footers: parsed.footers };
}
