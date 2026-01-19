import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('staff_salary_payments')
@Index(['staffSalaryId', 'paidAt'])
export class StaffSalaryPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StaffSalary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffSalaryId' })
  staffSalary: StaffSalary;

  @Column()
  staffSalaryId: number;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'paidById' })
  paidBy?: User | null;

  @Column({ nullable: true })
  paidById?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  paidAt: Date;
}
