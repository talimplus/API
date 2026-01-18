import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentBirthDateNullable1760000000018
  implements MigrationInterface
{
  name = 'StudentBirthDateNullable1760000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "birthDate" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // If DB already contains NULLs, this will fail; revert manually after fixing data.
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "birthDate" SET NOT NULL`);
  }
}

