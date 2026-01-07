import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

export enum PaymentStatus {
  PAID = 'paid',
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
}

@Entity('payments')
@Index(['studentId', 'groupId', 'forMonth'], { unique: true })
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column({ nullable: true })
  groupId: number | null;

  // NOTE: numeric(10,2) overflows for fees like 123,123,123.00 (needs >= 11 digits precision).
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amountDue: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  amountPaid: number;

  /**
   * Soft deadline (usually 10th of month in group timezone).
   */
  @Column({ type: 'date', nullable: true })
  dueDate: Date | null;

  /**
   * Hard deadline (usually 15th of month).
   */
  @Column({ type: 'date', nullable: true })
  hardDueDate: Date | null;

  /**
   * Total scheduled lessons in the month for this group (schedule-driven).
   */
  @Column({ type: 'int', nullable: true })
  lessonsPlanned: number | null;

  /**
   * How many lessons the student must pay for that month (<= lessonsPlanned).
   * For mid-month activation, this is smaller.
   */
  @Column({ type: 'int', nullable: true })
  lessonsBillable: number | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  status: PaymentStatus;

  @Column({ type: 'date' })
  forMonth: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
