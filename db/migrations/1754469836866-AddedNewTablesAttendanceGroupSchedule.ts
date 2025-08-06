import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedNewTablesAttendanceGroupSchedule1754469836866 implements MigrationInterface {
    name = 'AddedNewTablesAttendanceGroupSchedule1754469836866'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."group_schedule_day_enum" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')`);
        await queryRunner.query(`CREATE TABLE "group_schedule" ("id" SERIAL NOT NULL, "day" "public"."group_schedule_day_enum" NOT NULL, "startTime" TIME NOT NULL, "groupId" integer, CONSTRAINT "PK_625871e59eed4f6a703cfa753f0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "attendance" ("id" SERIAL NOT NULL, "date" date NOT NULL, "isPresent" boolean NOT NULL DEFAULT true, "reason" character varying, "studentId" integer, "groupId" integer, CONSTRAINT "PK_ee0ffe42c1f1a01e72b725c0cb2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "group_schedule" ADD CONSTRAINT "FK_466193fcbe25ce0ce6711984bca" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance" ADD CONSTRAINT "FK_120e1c6edcec4f8221f467c8039" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance" ADD CONSTRAINT "FK_2760be2ce05ac070bd6ecbdbc9a" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attendance" DROP CONSTRAINT "FK_2760be2ce05ac070bd6ecbdbc9a"`);
        await queryRunner.query(`ALTER TABLE "attendance" DROP CONSTRAINT "FK_120e1c6edcec4f8221f467c8039"`);
        await queryRunner.query(`ALTER TABLE "group_schedule" DROP CONSTRAINT "FK_466193fcbe25ce0ce6711984bca"`);
        await queryRunner.query(`DROP TABLE "attendance"`);
        await queryRunner.query(`DROP TABLE "group_schedule"`);
        await queryRunner.query(`DROP TYPE "public"."group_schedule_day_enum"`);
    }

}
