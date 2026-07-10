import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TopicDifficulty } from '../enums/topic-difficulty.enum';
import { Syllabus } from './syllabus.entity';

@Entity('syllabus_topics')
@Index(['syllabusId', 'orderIndex'])
export class SyllabusTopic {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Syllabus, (s) => s.topics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'syllabusId' })
  syllabus: Syllabus;

  @Column()
  syllabusId: number;

  /**
   * Mavzuning kurs ichidagi mantiqiy tartibi (0-based).
   */
  @Column({ type: 'int' })
  orderIndex: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({
    type: 'enum',
    enum: TopicDifficulty,
    default: TopicDifficulty.MEDIUM,
  })
  difficulty: TopicDifficulty;

  /**
   * Bu mavzu odatda nechta dars egallashi (AI taqsimlash va rejalashtirish uchun).
   */
  @Column({ type: 'int', default: 1 })
  estimatedLessons: number;

  /**
   * O'qituvchi uchun qo'llanma (markdown).
   */
  @Column({ type: 'text', nullable: true })
  guide?: string | null;

  /**
   * Darsda nimalar o'tilishi rejasi (markdown).
   */
  @Column({ type: 'text', nullable: true })
  lessonOutline?: string | null;

  /**
   * Uyga vazifa (markdown).
   */
  @Column({ type: 'text', nullable: true })
  homework?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
