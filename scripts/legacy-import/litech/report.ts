/** Modelni bazaga yozmasdan ko'rib chiqish uchun qisqa hisobot. */
import { Model } from './model';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

export function printModelReport(model: Model, opts: { verbose?: boolean } = {}) {
  const { groups, students, enrollments, payments, attendance, leads, warnings } = model;
  const live = students.filter((s) => enrollments.some((e) => e.studentIdx === s.idx));

  console.log('\n=== GURUHLAR ===');
  for (const g of groups) {
    const members = enrollments.filter((e) => e.groupIdx === g.idx);
    const months = g.months
      .map((m) => `${m.month.slice(5)}:${m.name ?? '∅'}(${m.rows.length})`)
      .join(' → ');
    const fees = Object.entries(g.feeByMonth)
      .map(([m, f]) => `${m.slice(5)}=${f / 1000}`)
      .join(',');
    console.log(
      `#${g.idx} [${g.sheet}] "${g.name}" ${g.status} ${g.startDate}..${g.endDate ?? '∞'} ` +
        `${g.startTime}/${g.lessonMinutes}m ${g.room ?? '-'} {${fees}} a'zo=${members.length}\n     ${months}`,
    );
  }

  const byStatus = new Map<string, number>();
  live.forEach((s) => byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1));
  console.log('\n=== O\'QUVCHILAR ===');
  console.log(`Jami (a'zoligi bor): ${live.length}; holat: ${JSON.stringify(Object.fromEntries(byStatus))}`);
  console.log(`Telefonsiz: ${live.filter((s) => !s.phone).length}`);
  console.log(
    `A'zolik oynalari: ${enrollments.length} (kutilayotgan: ${enrollments.filter((e) => e.pending).length}, yopilgan: ${enrollments.filter((e) => e.leftAt).length})`,
  );

  console.log('\n=== TO\'LOVLAR (sheet bo\'yicha) ===');
  const months = Array.from(new Set(payments.map((p) => p.month))).sort();
  for (const m of months) {
    const ps = payments.filter((p) => p.month === m);
    const footer = model.footers
      .filter((f) => f.month === m)
      .reduce((a, f) => a + (f.total ?? 0) * 1000, 0);
    console.log(
      `${m}: to'langan ${fmt(ps.reduce((a, p) => a + p.paid, 0))} (${ps.filter((p) => p.paid > 0).length} ta), ` +
        `tekin ${ps.filter((p) => p.free).length} ta; footer JAMI ${fmt(footer)}`,
    );
  }
  console.log(`Davomat yozuvlari: ${attendance.length}`);
  console.log(
    `Lidlar: ${leads.length} (o'quvchiga mos keldi: ${leads.filter((l) => l.matchedStudentIdx != null).length})`,
  );

  console.log(`\n=== OGOHLANTIRISHLAR (${warnings.length}) ===`);
  for (const w of opts.verbose ? warnings : warnings.slice(0, 40)) console.log(' - ' + w);
}
