import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';
import { SyllabusTopic } from './syllabus-topic.entity';

/**
 * Kurs rejasi (mavzular banki). Fanga bog'lanadi, guruh va vaqtga bog'lanmaydi.
 * Guruh ochilganda mavzular darslarga alohida biriktiriladi (GroupLessonTopic).
 */
@Entity('syllabuses')
export class Syllabus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  subject: Subject;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  createdBy?: User | null;

  @OneToMany(() => SyllabusTopic, (topic) => topic.syllabus)
  topics: SyllabusTopic[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
