/** Ism bo'yicha sheet qatorlarini qidirish (tahlil uchun): who.ts <qism> [<qism> ...] */
import { parseWorkbook } from './parse';
(async () => {
  const p = await parseWorkbook('new-data/LITECH 2026.xlsx');
  const q = process.argv.slice(2).map((s) => s.toLowerCase());
  for (const gm of p.groupMonths) for (const r of gm.rows)
    if (q.some((x) => r.name.toLowerCase().includes(x)))
      console.log(gm.sheet, gm.month, gm.name, '|', r.name, r.birth, r.phones.join(','), 'sum=', r.sum, r.receipt);
})();
