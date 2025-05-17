import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateStudentStatusEnum1747480823498 implements MigrationInterface {
    name = 'UpdateStudentStatusEnum1747480823498'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."students_status_enum" RENAME TO "students_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."students_status_enum" AS ENUM('new', 'ACTIVE', 'ignored', 'stopped')`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum" USING "status"::"text"::"public"."students_status_enum"`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'new'`);
        await queryRunner.query(`DROP TYPE "public"."students_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."students_status_enum_old" AS ENUM('yangi', 'oqimagan', 'oqiyapti', 'oqishni toxtatgan')`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" TYPE "public"."students_status_enum_old" USING "status"::"text"::"public"."students_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'yangi'`);
        await queryRunner.query(`DROP TYPE "public"."students_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."students_status_enum_old" RENAME TO "students_status_enum"`);
    }

}
