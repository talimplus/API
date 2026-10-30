import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<any[]>;
}

/**
 * Tashkilot ochilgan kun (`organizations.createdAt`, berilgan timezone'da,
 * YYYY-MM-DD). Orqaga sanalashning quyi chegarasi: markaz sistemaga
 * kirishidan oldingi kunga guruh boshlanishi / o'quvchi qo'shilishi
 * kiritilmaydi (bunday eski ma'lumot faqat bir martalik SQL import bilan).
 */
export async function organizationOpenedOn(
  db: Queryable,
  centerId: number,
  timezone = 'Asia/Tashkent',
): Promise<string | null> {
  const [row] = await db.query(
    `SELECT o."createdAt" FROM "organizations" o
       JOIN "centers" c ON c."organizationId" = o."id"
      WHERE c."id" = $1`,
    [centerId],
  );
  if (!row?.createdAt) return null;
  return dayjs(row.createdAt).tz(timezone).format('YYYY-MM-DD');
}

/** `date` tashkilot ochilgan kundan oldin bo'lsa — 422 `field`. */
export async function assertNotBeforeOrganization(
  db: Queryable,
  centerId: number | null | undefined,
  date: string,
  field: string,
  timezone?: string | null,
): Promise<void> {
  if (!centerId) return;
  const openedOn = await organizationOpenedOn(
    db,
    centerId,
    timezone || 'Asia/Tashkent',
  );
  if (openedOn && date < openedOn) {
    throw new ValidationException({
      [field]: `Tashkilot ${openedOn} da ochilgan — undan oldingi sana bo'lishi mumkin emas`,
    });
  }
}
