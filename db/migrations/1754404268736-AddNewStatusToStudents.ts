import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewStatusToStudents1754404268736 implements MigrationInterface {
    name = 'AddNewStatusToStudents1754404268736'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."students_status_enum" RENAME TO "students_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."students_status_enum" AS ENUM('new', 'ACTIVE', 'ignored', 'stopped', 'finished')`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum" USING "status"::"text"::"public"."students_status_enum"`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'new'`);
        await queryRunner.query(`DROP TYPE "public"."students_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."students_status_enum_old" AS ENUM('new', 'ACTIVE', 'ignored', 'stopped')`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum_old" USING "status"::"text"::"public"."students_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'new'`);
        await queryRunner.query(`DROP TYPE "public"."students_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."students_status_enum_old" RENAME TO "students_status_enum"`);
    }

}
