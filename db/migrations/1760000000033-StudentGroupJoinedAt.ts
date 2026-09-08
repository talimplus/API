import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O'quvchi guruhga QACHON qo'shilganini saqlash uchun students_groups_groups
 * (many-to-many) jadvaliga "joinedAt" ustuni qo'shamiz.
 *
 * Nega kerak: to'lov proratsiyasi (bir oyda nechta darsga pul so'ralishi)
 * ilgari faqat student.activatedAt va group.startDate asosida hisoblanardi.
 * Oy o'rtasida yangi guruhga qo'shilgan o'quvchiga butun oy hisoblanardi.
 * Endi shu guruhga qo'shilgan sana ham hisobga olinadi.
 *
 * Yangi biriktirilgan guruhlar DB default (now()) orqali avtomatik hozirgi
 * sanani oladi. Mavjud yozuvlar esa activatedAt/createdAt bilan backfill
 * qilinadi — bu eski o'quvchilarning proratsiyasini o'zgartirmaydi (xavfsiz).
 */
export class StudentGroupJoinedAt1760000000033
  implements MigrationInterface
{
  name = 'StudentGroupJoinedAt1760000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students_groups_groups" ADD COLUMN IF NOT EXISTS "joinedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );

    // Backfill: mavjud biriktirishlar uchun qo'shilgan sanani bilmaymiz, shuning
    // uchun eng xavfsiz taxmin — o'quvchining faollashgan (activatedAt) yoki
    // yaratilgan (createdAt) sanasi. Bu mavjud o'quvchilar to'lovini o'zgartirmaydi.
    await queryRunner.query(`
      UPDATE "students_groups_groups" sg
      SET "joinedAt" = COALESCE(s."activatedAt", s."createdAt")
      FROM "students" s
      WHERE s."id" = sg."studentsId";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students_groups_groups" DROP COLUMN IF EXISTS "joinedAt"`,
    );
  }
}
