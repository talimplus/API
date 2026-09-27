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

/**
 * Guruh o'qituvchisining TARIXI (kun aniqligida).
 *
 * `groups.teacher` — faqat HOZIRGI o'qituvchi. Komissiya esa shu jadvaldan
 * hisoblanadi: o'qituvchi oy o'rtasida almashsa, o'sha oyning puli ikki
 * o'qituvchi orasida o'quvchining darslari soniga qarab bo'linadi. Ilgari
 * butun oy (va o'tgan oylar ham, qayta hisoblashda) yangi o'qituvchiga
 * o'tib ketardi.
 *
 * Qoida: sana uchun o'qituvchi — `fromDate <= sana` ga mos ENG OXIRGI qator;
 * mos qator bo'lmasa — eng birinchisi. `teacherId = null` — o'qituvchisiz davr.
 */
@Entity('group_teacher_periods')
@Index(['groupId', 'fromDate'], { unique: true })
export class GroupTeacherPeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'teacherId' })
  teacher?: User | null;

  @Column({ type: 'int', nullable: true })
  teacherId: number | null;

  /** O'qituvchi guruhni olgan sana (guruh timezone'ida, inclusive). */
  @Column({ type: 'date' })
  fromDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
