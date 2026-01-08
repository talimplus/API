import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';

@Entity('teacher_monthly_earnings')
@Index(['teacherId', 'forMonth'], { unique: true })
export class TeacherMonthlyEarning {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @Column()
  teacherId: number;

  /**
   * Month being earned (DATE, first day of month).
   */
  @Column({ type: 'date' })
  forMonth: Date;

  /**
   * Snapshot of teacher.salary at calculation time.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  baseSalarySnapshot: number;

  /**
   * Commission calculated from PAID student payments for that month.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  commissionAmount: number;

  /**
   * Commission carryover applied from previous months (late payments).
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  carryOverCommission: number;

  /**
   * baseSalarySnapshot + commissionAmount + carryOverCommission
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  totalEarning: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  calculatedAt: Date;
}

