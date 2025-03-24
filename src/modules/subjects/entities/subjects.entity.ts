import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';

@Entity('subjects')
export class Subject {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
