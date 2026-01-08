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
   * First day of month (DATE).
   */
  @Column({ type: 'date' })
  forMonth: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  baseSalary: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  paidAmount: number;

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

