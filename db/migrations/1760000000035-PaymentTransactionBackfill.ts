import { MigrationInterface, QueryRunner } from 'typeorm';

/** Date -> "YYYYMMDD" (server mahalliy vaqti bo'yicha). */
function ymd(input: unknown): string {
  const d = input instanceof Date ? input : new Date(String(input));
  const dd = isNaN(d.getTime()) ? new Date() : d;
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, '0');
  const day = String(dd.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Tranzaktsiya raqami funksiyasidan OLDIN yaratilgan receipt'larga
 * transactionNo (TRX-YYYYMMDD-NNNNNN) to'ldiradi — shunda eski to'lovlar ham
 * chekda raqam bilan ko'rinadi va qaytib kelganda aniqlanadi.
 *
 * Ketma-ket raqam 34-migratsiyada yaratilgan global sequence'dan olinadi, shu
 * bois backfilldan keyin YANGI to'lovlar ham shu sequence'dan davom etadi
 * (raqamlar takrorlanmaydi). Tartib — to'lov qabul qilingan vaqt bo'yicha.
 */
export class PaymentTransactionBackfill1760000000035
  implements MigrationInterface
{
  name = 'PaymentTransactionBackfill1760000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: number; when: string | Date }> =
      await queryRunner.query(`
        SELECT id, COALESCE("receivedAt", "createdAt") AS when
          FROM payment_receipts
         WHERE "transactionNo" IS NULL
         ORDER BY COALESCE("receivedAt", "createdAt") ASC, id ASC
      `);

    for (const row of rows) {
      const seqRow = await queryRunner.query(
        `SELECT nextval('payment_receipt_transaction_seq') AS seq`,
      );
      const seq = Number(seqRow?.[0]?.seq ?? 0);
      const transactionNo = `TRX-${ymd(row.when)}-${String(seq).padStart(6, '0')}`;
      await queryRunner.query(
        `UPDATE payment_receipts SET "transactionNo" = $1 WHERE id = $2 AND "transactionNo" IS NULL`,
        [transactionNo, row.id],
      );
    }
  }

  public async down(): Promise<void> {
    // Data backfill — teskari qilib bo'lmaydi. Ustun va sequence 34-migratsiya
    // down'ida o'chiriladi. Bu yerda no-op.
  }
}
