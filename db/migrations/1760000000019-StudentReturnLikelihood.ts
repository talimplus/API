import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentReturnLikelihood1760000000019
  implements MigrationInterface
{
  name = 'StudentReturnLikelihood1760000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."students_return_likelihood_enum" AS ENUM ('never','maybe','sure');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "returnLikelihood" "public"."students_return_likelihood_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "returnLikelihood"`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'students_return_likelihood_enum') THEN
          DROP TYPE "public"."students_return_likelihood_enum";
        END IF;
      END $$;
    `);
  }
}

