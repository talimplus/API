/** Bir oyda 2+ guruhda o'qigan o'quvchilar: har guruh narxi va to'lagani (chegirma tahlili). */
import { parseWorkbook } from './parse';
import { buildModel } from './model';
(async () => {
  const model = buildModel(await parseWorkbook('new-data/LITECH 2026.xlsx'));
  const key = (s: number, m: string) => `${s}|${m}`;
  const map = new Map<string, { g: number; fee: number; paid: number; free: string | null }[]>();
  for (const p of model.payments) {
    const k = key(p.studentIdx, p.month);
    map.set(k, [...(map.get(k) ?? []), { g: p.groupIdx, fee: p.fullFee, paid: p.paid, free: p.free }]);
  }
  // a'zolik bo'yicha ham (to'lamaganlar)
  for (const [k, rows] of [...map.entries()].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]))) {
    if (rows.length < 2) continue;
    const [s, m] = k.split('|');
    const st = model.students[Number(s)];
    const cheap = [...rows].sort((a, b) => a.fee - b.fee)[0];
    const d = cheap.fee - cheap.paid;
    const tag = cheap.free ? 'tekin' : d === Math.round(cheap.fee * 0.1) ? '10%' : d === 20000 ? '20k' : d === 0 ? 'chegirmasiz' : `farq ${d}`;
    console.log(m, `${st.lastName} ${st.firstName}`.padEnd(30), rows.map((r) => `${model.groups[r.g].name}:${r.fee / 1000}/${r.paid / 1000}`).join('  '), '=>', tag);
  }
})();
