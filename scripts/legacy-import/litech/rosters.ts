/** Bir varaqdagi guruhlarning oyma-oy ro'yxati (tahlil uchun): rosters.ts <varaq> [oy...] */
import { parseWorkbook } from './parse';
(async () => {
  const [sheet, ...months] = process.argv.slice(2);
  const p = await parseWorkbook('new-data/LITECH 2026.xlsx');
  for (const gm of p.groupMonths) {
    if (gm.sheet !== sheet || !gm.rows.length || (months.length && !months.includes(gm.month))) continue;
    console.log(`\n${gm.month} ${gm.name ?? '(nomsiz)'} ${gm.time ?? ''} ${gm.room ?? ''}`);
    gm.rows.forEach((r) => console.log(`   ${r.name}  ${r.sum ?? ''}`));
  }
})();
