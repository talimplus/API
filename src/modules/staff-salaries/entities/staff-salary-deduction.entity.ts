import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffDeduction } from '@/modules/staff-salaries/entities/staff-deduction.entity';

/**
 * Jarimaning aynan qaysi oy oyligidan qancha ushlab qolingani.
 *
 * Bitta jarima bir necha oyga bo'linishi mumkin (oylikdan katta bo'lsa),
 * shuning uchun bu alohida jadval: "sentabr oyligidan 300 000, oktabrdan
 * 200 000 ushlandi" degan tarix shu yerda saqlanadi.
 */
@Entity('staff_salary_deductions')
@Index(['staffSalaryId'])
@Index(['staffSalaryId', 'deductionId'], { unique: true })
export class StaffSalaryDeduction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StaffSalary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffSalaryId' })
  staffSalary: StaffSalary;

  @Column()
  staffSalaryId: number;

  @ManyToOne(() => StaffDeduction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deductionId' })
  deduction: StaffDeduction;

  @Column()
  deductionId: number;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
