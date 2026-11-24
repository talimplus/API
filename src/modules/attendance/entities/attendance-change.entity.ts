import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** `newStatus`: belgi olib tashlandi (boshlang'ich holat). */
export const ATTENDANCE_CLEARED = 'cleared';

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

  /** Davomat statusi yoki `ATTENDANCE_CLEARED`. */
  @Column({ type: 'text' })
  newStatus: string;

  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ default: false })
  byGroupTeacher: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
