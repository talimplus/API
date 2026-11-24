import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Davomat o'zgarishlari jurnali. `attendance` da faqat oxirgi holat turadi;
 * bu yerda har bir belgilash/o'zgartirish kim tomonidan qilingani saqlanadi.
 * Tarixda faqat `byGroupTeacher = false` (admin yoki begona xodim) ko'rinadi.
 */
@Entity('attendance_changes')
@Index(['groupId', 'createdAt'])
@Index(['studentId', 'createdAt'])
export class AttendanceChange {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  groupId: number;

  @Column()
  studentId: number;

  @Column({ type: 'date' })
  lessonDate: string;

  /** NULL — birinchi marta belgilandi. */
  @Column({ type: 'text', nullable: true })
  oldStatus: string | null;

  @Column({ type: 'text' })
  newStatus: string;

  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ default: false })
  byGroupTeacher: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
