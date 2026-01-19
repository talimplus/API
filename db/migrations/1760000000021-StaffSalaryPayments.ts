import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class StaffSalaryPayments1760000000021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'staff_salary_payments',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'staffSalaryId',
            type: 'int',
          },
          {
            name: 'amount',
            type: 'numeric',
            precision: 14,
            scale: 2,
          },
          {
            name: 'comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'paidById',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'paidAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'staff_salary_payments',
      new TableIndex({
        name: 'IDX_staff_salary_payments_staffSalaryId_paidAt',
        columnNames: ['staffSalaryId', 'paidAt'],
      }),
    );

    await queryRunner.createForeignKey(
      'staff_salary_payments',
      new TableForeignKey({
        columnNames: ['staffSalaryId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'staff_salaries',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'staff_salary_payments',
      new TableForeignKey({
        columnNames: ['paidById'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('staff_salary_payments');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('staff_salary_payments', fk);
      }
      await queryRunner.dropIndex(
        'staff_salary_payments',
        'IDX_staff_salary_payments_staffSalaryId_paidAt',
      );
      await queryRunner.dropTable('staff_salary_payments');
    }
  }
}
