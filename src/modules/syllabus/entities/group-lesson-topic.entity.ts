import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { SyllabusTopic } from './syllabus-topic.entity';

/**
 * Guruh dars rejasi: mavzu guruhning nechanchi darsida o'tilishini bog'laydi.
 * Sanaga emas, dars tartib raqamiga bog'lanadi — bekor qilingan/ko'chirilgan
 * darslar reja tartibini buzmaydi.
 */
@Entity('group_lesson_topics')
@Index(['groupId', 'lessonNumber'])
@Index(['groupId', 'topicId', 'lessonNumber'], { unique: true })
export class GroupLessonTopic {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  /**
   * Guruhning nechanchi darsi (1-based, jadval bo'yicha hisoblanadi).
   */
  @Column({ type: 'int' })
  lessonNumber: number;

  @ManyToOne(() => SyllabusTopic, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topicId' })
  topic: SyllabusTopic;

  @Column()
  topicId: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
