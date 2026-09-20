import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bir martalik normalizatsiya: barcha guruhlari tugagan, lekin hali ACTIVE
 * bo'lib turgan o'quvchilarni `finished` qilamiz.
 *
 * Bundan keyin bu avtomatik ishlaydi (guruh yopilganda / statusi
 * o'zgarganda GroupsService.syncStudentStatusesForGroups chaqiriladi).
 *
 * MUHIM: o'quvchi bir nechta guruhda (fanda) o'qiyotgan bo'lsa va kamida
 * bittasi davom etayotgan bo'lsa — statusi o'zgarmaydi.
 * Teskari yo'nalish (finished -> ACTIVE) bu yerda qo'llanmaydi: qo'lda
 * yopilgan o'quvchilar shundayligicha qoladi.
 */
export class SyncFinishedStudentStatuses1760000000040
  implements MigrationInterface
{
  name = 'SyncFinishedStudentStatuses1760000000040';

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
    // Ma'lumot normalizatsiyasi — orqaga qaytarilmaydi (qaysi o'quvchi
    // avval ACTIVE bo'lganini bilib bo'lmaydi).
  }
}
