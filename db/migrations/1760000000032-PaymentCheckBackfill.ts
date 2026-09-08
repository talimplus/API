import { MigrationInterface, QueryRunner } from 'typeorm';

/** 1 -> A, 2 -> B, ... 26 -> Z, 27 -> AA (Excel uslubi). */
function columnLetter(n: number): string {
  let s = '';
  let x = Math.max(1, Math.floor(n));
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Bir martalik to'liq to'lov -> "1"; qisman -> "1-A", "1-A-B" ... */
function buildCheckNo(
  invoiceNo: number,
  installmentIndex: number,
  singleFull: boolean,
): string {
  if (installmentIndex <= 1 && singleFull) return String(invoiceNo);
  const letters: string[] = [];
  for (let i = 1; i <= installmentIndex; i++) letters.push(columnLetter(i));
  return `${invoiceNo}-${letters.join('-')}`;
}

/**
 * Chek funksiyasidan OLDIN yaratilgan receipt'larga chek raqamlarini (invoiceNo,
 * installmentIndex, checkNo) to'ldiradi — shunda to'lovlar tarixi endpoint'i
 * eski yozuvlar uchun ham raqam qaytaradi (null emas).
 *
 * ESLATMA: balanceBefore/balanceAfter — to'lov PAYTIDAGI umumiy qarz snapshot'i.
 * Uni o'sha vaqtga qaytarib aniq tiklab bo'lmaydi, shu sabab eski receipt'larda
 * bu maydonlar NULL qoladi (frontend "—" ko'rsatadi). Yangi to'lovlar to'g'ri
 * snapshot bilan yoziladi.
 */
export class PaymentCheckBackfill1760000000032 implements MigrationInterface {
  name = 'PaymentCheckBackfill1760000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. payments.invoiceNo — receipt'i bor, lekin raqami yo'q payment'larga
    //     markaz (center) ichida ketma-ket raqam beramiz (eng eski to'lovdan).
    const needNo: Array<{ payment_id: number; center_id: number | null }> =
      await queryRunner.query(`
        SELECT p.id AS payment_id, s."centerId" AS center_id,
               MIN(COALESCE(r."receivedAt", r."createdAt")) AS first_at
          FROM payments p
          JOIN students s ON s.id = p."studentId"
          JOIN payment_receipts r ON r."paymentId" = p.id
         WHERE p."invoiceNo" IS NULL
         GROUP BY p.id, s."centerId"
         ORDER BY s."centerId", first_at ASC, p.id ASC
      `);

    const maxByCenter = new Map<string, number>();
    const maxRows: Array<{ center_id: number | null; max: string }> =
      await queryRunner.query(`
        SELECT s."centerId" AS center_id, COALESCE(MAX(p."invoiceNo"), 0) AS max
          FROM payments p
          JOIN students s ON s.id = p."studentId"
         WHERE p."invoiceNo" IS NOT NULL
         GROUP BY s."centerId"
      `);
    for (const m of maxRows) {
      maxByCenter.set(String(m.center_id), Number(m.max ?? 0));
    }

    for (const row of needNo) {
      const key = String(row.center_id);
      const next = (maxByCenter.get(key) ?? 0) + 1;
      maxByCenter.set(key, next);
      await queryRunner.query(
        `UPDATE payments SET "invoiceNo" = $1 WHERE id = $2`,
        [next, row.payment_id],
      );
    }

    // ── 2. payment_receipts — checkNo yo'q receipt'larga invoiceNo (nusxa),
    //     installmentIndex (vaqt bo'yicha 1..n) va checkNo ni yozamiz.
    const payments: Array<{
      payment_id: number;
      invoice_no: number;
      amount_due: string;
    }> = await queryRunner.query(`
      SELECT DISTINCT p.id AS payment_id, p."invoiceNo" AS invoice_no,
             p."amountDue" AS amount_due
        FROM payments p
        JOIN payment_receipts r ON r."paymentId" = p.id
       WHERE r."checkNo" IS NULL AND p."invoiceNo" IS NOT NULL
    `);

    for (const p of payments) {
      const receipts: Array<{ id: number; amount: string }> =
        await queryRunner.query(
          `SELECT id, amount
             FROM payment_receipts
            WHERE "paymentId" = $1
            ORDER BY COALESCE("receivedAt", "createdAt") ASC, id ASC`,
          [p.payment_id],
        );

      const total = receipts.length;
      const amountDue = Number(p.amount_due ?? 0);
      let idx = 0;
      for (const rc of receipts) {
        idx += 1;
        const singleFull = total === 1 && Number(rc.amount ?? 0) >= amountDue;
        const checkNo = buildCheckNo(Number(p.invoice_no), idx, singleFull);
        await queryRunner.query(
          `UPDATE payment_receipts
              SET "invoiceNo" = $1, "installmentIndex" = $2, "checkNo" = $3
            WHERE id = $4 AND "checkNo" IS NULL`,
          [Number(p.invoice_no), idx, checkNo, rc.id],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Data backfill — teskari qilib bo'lmaydi (backfill qilingan va jonli
    // yozilgan qiymatlarni ajratib bo'lmaydi). Ustunlarning o'zi 31-migratsiya
    // down'ida o'chiriladi. Bu yerda no-op.
  }
}
