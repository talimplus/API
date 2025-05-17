import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  Column,
  JoinColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referredStudentId' })
  referredStudent: Student;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referrerStudentId' })
  referrerStudent: Student;

  @Column({ default: false })
  isDiscountApplied: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createAt: Date;
}
