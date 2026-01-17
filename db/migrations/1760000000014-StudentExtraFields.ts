import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentExtraFields1760000000014 implements MigrationInterface {
  name = 'StudentExtraFields1760000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD "secondPhone" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "students" ADD "comment" text`);
    await queryRunner.query(`ALTER TABLE "students" ADD "heardAboutUs" text`);
    await queryRunner.query(
      `ALTER TABLE "students" ADD "preferredTime" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "preferredDays" text array`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "passportSeries" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "passportNumber" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "jshshir" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "jshshir"`);
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "passportNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "passportSeries"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "preferredDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "preferredTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "heardAboutUs"`,
    );
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "comment"`);
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "secondPhone"`,
    );
  }
}

