import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';

@Entity('lessons')
export class Lesson {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  group: Group;

  @Column({ type: 'date' })
  lessonDate: Date;

  @Column({ type: 'time' })
  startTime: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
