import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  expenseDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
