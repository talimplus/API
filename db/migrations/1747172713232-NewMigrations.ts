import { MigrationInterface, QueryRunner } from "typeorm";

export class NewMigrations1747172713232 implements MigrationInterface {
    name = 'NewMigrations1747172713232'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "studentId" integer`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_42dc3c1fa59ce4a36a19cff2721" UNIQUE ("studentId")`);
        await queryRunner.query(`ALTER TABLE "students" DROP CONSTRAINT "UQ_317b86154bca256bdf5432f134c"`);
        await queryRunner.query(`ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('super_admin', 'admin', 'teacher', 'manager', 'other', 'student')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'admin'`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_42dc3c1fa59ce4a36a19cff2721"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum_old" AS ENUM('super_admin', 'admin', 'teacher', 'manager', 'other')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'admin'`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`);
        await queryRunner.query(`ALTER TABLE "students" ADD CONSTRAINT "UQ_317b86154bca256bdf5432f134c" UNIQUE ("phone")`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_42dc3c1fa59ce4a36a19cff2721"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "studentId"`);
    }

}
