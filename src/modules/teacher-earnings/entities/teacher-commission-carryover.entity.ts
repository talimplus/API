import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';

@Entity('teacher_commission_carryovers')
@Index(['teacherId', 'appliedForMonth'])
export class TeacherCommissionCarryOver {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @Column()
  teacherId: number;

  /**
   * Month where this carryover originated (late payment for this month).
   */
  @Column({ type: 'date' })
  sourceForMonth: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  /**
   * Month where this carryover got applied (NULL until applied).
   */
  @Column({ type: 'date', nullable: true })
  appliedForMonth?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  appliedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}

