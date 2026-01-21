import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from 'typeorm';

export class StudentSubject1760000000023 implements MigrationInterface {
  name = 'StudentSubject1760000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add subjectId column
    await queryRunner.addColumn(
      'students',
      new TableColumn({
        name: 'subjectId',
        type: 'int',
        isNullable: true,
      }),
    );

    // Add foreign key constraint
    await queryRunner.createForeignKey(
      'students',
      new TableForeignKey({
        columnNames: ['subjectId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'subjects',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('students');
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('subjectId') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('students', foreignKey);
      }
    }
    await queryRunner.dropColumn('students', 'subjectId');
  }
}
