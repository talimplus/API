import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewColumnGroupTable1756613024710 implements MigrationInterface {
    name = 'AddNewColumnGroupTable1756613024710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "groups" ADD "roomId" integer`);
        await queryRunner.query(`ALTER TABLE "groups" ADD CONSTRAINT "FK_4115ffc9504b17d3abdc16ce557" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "groups" DROP CONSTRAINT "FK_4115ffc9504b17d3abdc16ce557"`);
        await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "roomId"`);
    }

}
