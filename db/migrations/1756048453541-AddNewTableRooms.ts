import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewTableRooms1756048453541 implements MigrationInterface {
    name = 'AddNewTableRooms1756048453541'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rooms" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "centerId" integer, CONSTRAINT "PK_0368a2d7c215f2d0458a54933f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "rooms" ADD CONSTRAINT "FK_8e05383fe12146e46f9793c2f1f" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rooms" DROP CONSTRAINT "FK_8e05383fe12146e46f9793c2f1f"`);
        await queryRunner.query(`DROP TABLE "rooms"`);
    }

}
