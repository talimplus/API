import { MigrationInterface, QueryRunner } from 'typeorm';

export class SyllabusLessonPlans1760000000027 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "syllabus_topics_difficulty_enum" AS ENUM('easy', 'medium', 'hard')`,
    );

    await queryRunner.query(`
      CREATE TABLE "syllabuses" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "description" text,
        "subjectId" integer,
        "centerId" integer,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_syllabuses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_syllabuses_subject" FOREIGN KEY ("subjectId")
          REFERENCES "subjects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_syllabuses_center" FOREIGN KEY ("centerId")
          REFERENCES "centers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_syllabuses_created_by" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "syllabus_topics" (
        "id" SERIAL NOT NULL,
        "syllabusId" integer NOT NULL,
        "orderIndex" integer NOT NULL,
        "title" character varying NOT NULL,
        "description" text,
        "difficulty" "syllabus_topics_difficulty_enum" NOT NULL DEFAULT 'medium',
        "estimatedLessons" integer NOT NULL DEFAULT 1,
        "guide" text,
        "lessonOutline" text,
        "homework" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_syllabus_topics" PRIMARY KEY ("id"),
        CONSTRAINT "FK_syllabus_topics_syllabus" FOREIGN KEY ("syllabusId")
          REFERENCES "syllabuses"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_syllabus_topics_syllabus_order" ON "syllabus_topics" ("syllabusId", "orderIndex")`,
    );

    await queryRunner.query(`
      CREATE TABLE "group_lesson_topics" (
        "id" SERIAL NOT NULL,
        "groupId" integer NOT NULL,
        "lessonNumber" integer NOT NULL,
        "topicId" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_lesson_topics" PRIMARY KEY ("id"),
        CONSTRAINT "FK_group_lesson_topics_group" FOREIGN KEY ("groupId")
          REFERENCES "groups"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_group_lesson_topics_topic" FOREIGN KEY ("topicId")
          REFERENCES "syllabus_topics"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_group_lesson_topics_group_lesson" ON "group_lesson_topics" ("groupId", "lessonNumber")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_group_lesson_topics_unique" ON "group_lesson_topics" ("groupId", "topicId", "lessonNumber")`,
    );

    await queryRunner.query(
      `ALTER TABLE "groups" ADD "syllabusId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD CONSTRAINT "FK_groups_syllabus" FOREIGN KEY ("syllabusId") REFERENCES "syllabuses"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "groups" DROP CONSTRAINT "FK_groups_syllabus"`,
    );
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "syllabusId"`);
    await queryRunner.query(`DROP TABLE "group_lesson_topics"`);
    await queryRunner.query(`DROP TABLE "syllabus_topics"`);
    await queryRunner.query(`DROP TABLE "syllabuses"`);
    await queryRunner.query(`DROP TYPE "syllabus_topics_difficulty_enum"`);
  }
}
