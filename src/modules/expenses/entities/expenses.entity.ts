import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'centerId' })
  center: Center;

  @Column({ nullable: true })
  centerId: number | null;

  @Column()
  name: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /**
   * Month of expense (DATE, first day of month).
   */
  @Column({ type: 'date' })
  forMonth: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
