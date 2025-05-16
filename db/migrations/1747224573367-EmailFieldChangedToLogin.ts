import { MigrationInterface, QueryRunner } from "typeorm";

export class EmailFieldChangedToLogin1747224573367 implements MigrationInterface {
    name = 'EmailFieldChangedToLogin1747224573367'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "email" TO "login"`);
        await queryRunner.query(`ALTER TABLE "users" RENAME CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" TO "UQ_2d443082eccd5198f95f2a36e2c"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" RENAME CONSTRAINT "UQ_2d443082eccd5198f95f2a36e2c" TO "UQ_97672ac88f789774dd47f7c8be3"`);
        await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "login" TO "email"`);
    }

}
