import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('attendance_lesson_overrides')
@Index(['groupId', 'fromDate'], { unique: true })
@Index(['groupId', 'toDate'], { unique: true })
export class AttendanceLessonOverride {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Scheduled lesson date that is moved away (YYYY-MM-DD, group timezone).
   */
  @Column({ type: 'date' })
  fromDate: Date;

  /**
   * New lesson date (YYYY-MM-DD, group timezone).
   */
  @Column({ type: 'date' })
  toDate: Date;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User | null;

  @Column({ nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
