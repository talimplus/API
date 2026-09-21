import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * XONA O'CHIRILGANDA GURUH O'CHMASLIGI KERAK.
 *
 * Muammo 1: `groups.roomId` FK'si `ON DELETE CASCADE` edi — xona o'chirilsa
 * o'sha xonadagi **barcha guruhlar** o'chib ketardi (ular bilan birga davomat,
 * jadval, narx tarixi va a'zolik oynalari ham). Kutilgan xatti-harakat esa
 * boshqacha: xona o'chsa, guruhdan faqat **xona** uziladi.
 *
 * Muammo 2: guruhni tahrirlashda xona boshqa filialga tegishli ekani
 * tekshirilmasdi. Natijada 2-filial guruhi 1-filialning xonasiga ulanib
 * qolgan va foydalanuvchi o'z filialidan xonani o'chirsa ham, guruh
 * ro'yxatida o'sha xona nomi ko'rinib turardi.
 *
 * Yechim: FK -> `ON DELETE SET NULL` va boshqa filialga tegishli
 * bog'lanishlarni tozalash. (Tekshiruvning o'zi `GroupsService.update` da.)
 */
export class GroupRoomSetNull1760000000048 implements MigrationInterface {
  name = 'GroupRoomSetNull1760000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Eski FK nomi TypeORM tomonidan generatsiya qilingan — nomi bo'yicha emas,
    // ustun bo'yicha topamiz (turli bazalarda nom har xil bo'lishi mumkin).
    const rows = await queryRunner.query(`
      SELECT tc.constraint_name AS name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
       WHERE tc.table_name = 'groups'
         AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'roomId'
    `);

    for (const row of rows ?? []) {
      await queryRunner.query(
        `ALTER TABLE "groups" DROP CONSTRAINT IF EXISTS "${row.name}"`,
      );
    }

    // Boshqa filialga tegishli xonalar — noto'g'ri bog'lanish, tozalanadi.
    await queryRunner.query(`
      UPDATE "groups" g
         SET "roomId" = NULL
        FROM "rooms" r
       WHERE r."id" = g."roomId"
         AND r."centerId" IS DISTINCT FROM g."centerId"
    `);

    await queryRunner.query(`
      ALTER TABLE "groups"
        ADD CONSTRAINT "FK_groups_room"
        FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "groups" DROP CONSTRAINT IF EXISTS "FK_groups_room"
    `);
    await queryRunner.query(`
      ALTER TABLE "groups"
        ADD CONSTRAINT "FK_groups_room"
        FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE
    `);
  }
}
