import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeStudentsAndPaymentsTable1747561235331 implements MigrationInterface {
    name = 'ChangeStudentsAndPaymentsTable1747561235331'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_c78ec2f5492035120c394625663"`);
        await queryRunner.query(`ALTER TABLE "students" DROP CONSTRAINT "FK_cc296de36cadf8de53b9cd60aa7"`);
        await queryRunner.query(`CREATE TABLE "students_groups_groups" ("studentsId" integer NOT NULL, "groupsId" integer NOT NULL, CONSTRAINT "PK_bd2797817e486d3769f415a7eb1" PRIMARY KEY ("studentsId", "groupsId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_97fb33bee4c990b82cf307f1f6" ON "students_groups_groups" ("studentsId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c63201d55115ec4f63844060c4" ON "students_groups_groups" ("groupsId") `);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "paymentDate"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "centerId"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "groupId"`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "amountDue" numeric(10,2) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "amountPaid" numeric(10,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "forMonth" date NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "groupId" integer`);
        await queryRunner.query(`ALTER TYPE "public"."payments_status_enum" RENAME TO "payments_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('paid', 'unpaid', 'partial')`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" TYPE "public"."payments_status_enum" USING "status"::"text"::"public"."payments_status_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'unpaid'`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_09739b0587054798a29e7eb17df" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "students_groups_groups" ADD CONSTRAINT "FK_97fb33bee4c990b82cf307f1f6e" FOREIGN KEY ("studentsId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "students_groups_groups" ADD CONSTRAINT "FK_c63201d55115ec4f63844060c4d" FOREIGN KEY ("groupsId") REFERENCES "groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "students_groups_groups" DROP CONSTRAINT "FK_c63201d55115ec4f63844060c4d"`);
        await queryRunner.query(`ALTER TABLE "students_groups_groups" DROP CONSTRAINT "FK_97fb33bee4c990b82cf307f1f6e"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_09739b0587054798a29e7eb17df"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum_old" AS ENUM('tolandi', 'qisman tolandi', 'tolanmadi')`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" TYPE "public"."payments_status_enum_old" USING "status"::"text"::"public"."payments_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'tolanmadi'`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."payments_status_enum_old" RENAME TO "payments_status_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "groupId"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "forMonth"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "amountPaid"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "amountDue"`);
        await queryRunner.query(`ALTER TABLE "students" ADD "groupId" integer`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "centerId" integer`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "paymentDate" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "amount" numeric NOT NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c63201d55115ec4f63844060c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97fb33bee4c990b82cf307f1f6"`);
        await queryRunner.query(`DROP TABLE "students_groups_groups"`);
        await queryRunner.query(`ALTER TABLE "students" ADD CONSTRAINT "FK_cc296de36cadf8de53b9cd60aa7" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_c78ec2f5492035120c394625663" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
