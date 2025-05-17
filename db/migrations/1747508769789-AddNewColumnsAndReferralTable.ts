import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewColumnsAndReferralTable1747508769789 implements MigrationInterface {
    name = 'AddNewColumnsAndReferralTable1747508769789'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "referrals" ("id" SERIAL NOT NULL, "isDiscountApplied" boolean NOT NULL DEFAULT false, "createAt" TIMESTAMP NOT NULL DEFAULT now(), "referredStudentId" integer, "referrerStudentId" integer, CONSTRAINT "PK_ea9980e34f738b6252817326c08" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "groups" ADD "monthlyFee" numeric`);
        await queryRunner.query(`ALTER TABLE "students" ADD "monthlyFee" numeric`);
        await queryRunner.query(`ALTER TABLE "students" ADD "referralDiscount" numeric NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "referrals" ADD CONSTRAINT "FK_9fe111b095aa8a6e1401f486691" FOREIGN KEY ("referredStudentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "referrals" ADD CONSTRAINT "FK_24aa8f69bbfe94b3d7e3a0a189d" FOREIGN KEY ("referrerStudentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "referrals" DROP CONSTRAINT "FK_24aa8f69bbfe94b3d7e3a0a189d"`);
        await queryRunner.query(`ALTER TABLE "referrals" DROP CONSTRAINT "FK_9fe111b095aa8a6e1401f486691"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "referralDiscount"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "monthlyFee"`);
        await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "monthlyFee"`);
        await queryRunner.query(`DROP TABLE "referrals"`);
    }

}
