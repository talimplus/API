import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCASCADEToUserEntityStudent1747483287903
  implements MigrationInterface
{
  name = 'AddCASCADEToUserEntityStudent1747483287903';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'FK_42dc3c1fa59ce4a36a19cff2721'
        ) THEN
          ALTER TABLE "users" DROP CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721";
        END IF;
      END;
      $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."students_status_enum" RENAME TO "students_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."students_status_enum" AS ENUM('new', 'ACTIVE', 'ignored', 'stopped')`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum" USING "status"::"text"::"public"."students_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'new'`,
    );
    await queryRunner.query(`DROP TYPE "public"."students_status_enum_old"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."students_status_enum_old" AS ENUM('yangi', 'oqimagan', 'oqiyapti', 'oqishni toxtatgan')`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum_old" USING "status"::"text"::"public"."students_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'yangi'`,
    );
    await queryRunner.query(`DROP TYPE "public"."students_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."students_status_enum_old" RENAME TO "students_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
