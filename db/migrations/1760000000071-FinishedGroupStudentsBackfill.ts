import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill: muddati o'tib AVTOMATIK yopilgan guruhlarning o'quvchilari
 * `finished` bo'lmay qolgan edi — `finishExpiredGroups` / kunlik cron
 * `UPDATE … RETURNING` natijasini noto'g'ri o'qigani uchun
 * `syncStudentStatusesForGroups` hech qachon chaqirilmagan (tuzatildi:
 * `shared/utils/returning-rows.ts`).
 *
 * Qoida `syncStudentStatusesForGroups` bilan bir xil: hozirgi BARCHA guruhlari
 * tugagan ACTIVE o'quvchi → `finished`. Guruhsiz o'quvchiga tegilmaydi.
 * Idempotent; to'lovlarga ta'sir qilmaydi (to'lov guruh `endDate` bilan
 * chegaralangan, status emas).
 */
export class FinishedGroupStudentsBackfill1760000000071
  implements MigrationInterface
{
  name = 'FinishedGroupStudentsBackfill1760000000071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "students" s
         SET "status" = 'finished'
       WHERE s."status" = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM "students_groups_groups" sg
            WHERE sg."studentsId" = s."id"
         )
         AND NOT EXISTS (
           SELECT 1 FROM "students_groups_groups" sg
             JOIN "groups" g ON g."id" = sg."groupsId"
            WHERE sg."studentsId" = s."id" AND g."status" <> 'finished'
         )
    `);
  }

  public async down(): Promise<void> {
    // Ma'lumot tuzatish — qaytarilmaydi (qaysi o'quvchi oldin ACTIVE edi,
    // saqlanmagan; ACTIVE qilib qaytarish xatoni qayta tiklagan bo'lardi).
  }
}
