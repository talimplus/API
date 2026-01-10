import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';

@Entity('student_discount_periods')
@Index(['studentId', 'fromMonth', 'toMonth'])
export class StudentDiscountPeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  /**
   * Month start (DATE, first day of month). Inclusive.
   */
  @Column({ type: 'date' })
  fromMonth: Date;

  /**
   * Month start (DATE, first day of month). Inclusive. NULL = permanent (no end).
   */
  @Column({ type: 'date', nullable: true })
  toMonth?: Date | null;

  @Column({ type: 'numeric', default: 0 })
  percent: number;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}

