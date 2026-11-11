import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';

@Entity('staff_salaries')
@Index(['userId', 'forMonth'], { unique: true })
export class StaffSalary {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  /**
   * ISH oyi (oyning 1-kuni). Pul keyingi oyda berilsa ham oylik shu oyda turadi.
   */
  @Column({ type: 'date' })
  forMonth: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  baseSalary: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  paidAmount: number;

  /**
   * Shu oy oyligidan ushlab qolingan jarimalar yig'indisi
   * (`staff_salary_deductions` ning denormalizatsiyasi — ro'yxatni tez chizish uchun).
   * To'lanishi kerak bo'lgan summa: `baseSalary - deductionAmount`.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  deductionAmount: number;

  /**
   * `deductionAmount` ning AVANSdan iborat qismi (oldindan berilgan pul).
   * Jarima = `deductionAmount − advanceAmount`; berilgan pul jami =
   * `paidAmount + advanceAmount`.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  advanceAmount: number;

  /** Shu oy mukofotlari yig'indisi (`staff_bonuses`) — oylikka qo'shiladi. */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  bonusAmount: number;

  @Column({
    type: 'enum',
    enum: StaffSalaryStatus,
    default: StaffSalaryStatus.UNPAID,
  })
  status: StaffSalaryStatus;

  @Column({ type: 'timestamp', nullable: true })
  paidAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
