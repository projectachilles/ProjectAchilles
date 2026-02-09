import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1770531883411 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS achilles`);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
    }

}
