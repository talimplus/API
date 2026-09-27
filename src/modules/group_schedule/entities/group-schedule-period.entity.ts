import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { Group } from '@/modules/groups/entities/groups.entity';

export interface SchedulePeriodDay {
  day: WeekDay;
  startTime: string;
}

/**
 * Guruh dars jadvalining TARIXI (kun aniqligida).
 *
 * `group_schedule` — faqat HOZIRGI jadval (dars jadvali sahifasi, xona/o'qituvchi
 * bandligi uchun). O'tgan sanalar uchun qaysi kunlari dars bo'lgani esa shu
 * jadvaldan o'qiladi: jadval haftasiga 3 kundan 5 kunga o'zgartirilsa, eski
 * darslar (davomat, to'lov proratsiyasi, kechikish) eski jadvalda qoladi.
 *
 * Qoida: sana uchun jadval — `fromDate <= sana` shartiga mos ENG OXIRGI qator;
 * mos qator bo'lmasa (sana eng birinchi qatordan ham oldin) — eng birinchisi.
 * Jadval bo'sh bo'lsa `group_schedule` ishlatiladi (eski xatti-harakat).
 */
@Entity('group_schedule_periods')
@Index(['groupId', 'fromDate'], { unique: true })
export class GroupSchedulePeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, (group) => group.schedulePeriods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  /** Jadval kuchga kirgan sana (guruh timezone'ida, inclusive). */
  @Column({ type: 'date' })
  fromDate: Date;

  /** Shu sanadan boshlab amal qiladigan dars kunlari va vaqti. */
  @Column({ type: 'jsonb' })
  days: SchedulePeriodDay[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
