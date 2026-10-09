import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ishga nomzodlar (`candidates`) — HR bazasi: ish so'rab kelganlar va
 * markaz o'zi topgan odamlar. Xodim emas, tizimga kirmaydi.
 */
export class Candidates1760000000067 implements MigrationInterface {
  name = 'Candidates1760000000067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "candidates" (
        "id" SERIAL NOT NULL,
        "organizationId" integer NOT NULL,
        "centerId" integer NOT NULL,
        "firstName" character varying NOT NULL,
        "lastName" character varying NOT NULL,
        "phone" character varying NOT NULL,
        "experience" text NOT NULL,
        "birthYear" integer NOT NULL,
        "subjectId" integer,
        "address" text,
        "comment" text,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_candidates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_candidates_org_center"
        ON "candidates" ("organizationId", "centerId")
    `);
    for (const [name, col, ref, onDelete] of [
      [
        'FK_candidates_organization',
        'organizationId',
        'organizations',
        'CASCADE',
      ],
      ['FK_candidates_center', 'centerId', 'centers', 'CASCADE'],
      ['FK_candidates_subject', 'subjectId', 'subjects', 'SET NULL'],
      ['FK_candidates_created_by', 'createdById', 'users', 'SET NULL'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "candidates" DROP CONSTRAINT IF EXISTS "${name}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "candidates" ADD CONSTRAINT "${name}"
         FOREIGN KEY ("${col}") REFERENCES "${ref}"("id")
         ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "candidates"`);
  }
}
