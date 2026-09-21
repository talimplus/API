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

/**
 * Guruh oylik narxining tarixi (oy aniqligida).
 *
 * MUHIM: to'lovlar uchun narxning YAGONA MANBASI shu jadval.
 * `groups.monthlyFee` — faqat joriy oyda amal qilayotgan narxning
 * denormalizatsiya qilingan nusxasi (ro'yxat/eksportlarda ko'rsatish uchun).
 *
 * Qoida: bir oy uchun bitta qator (groupId + fromMonth unique). Oy uchun
 * amaldagi narx — `fromMonth <= forMonth` shartiga mos ENG OXIRGI qator.
 * Agar mos qator bo'lmasa (forMonth eng birinchi qatordan ham oldin) —
 * eng birinchi qator narxi olinadi.
 */
@Entity('group_fee_periods')
@Index(['groupId', 'fromMonth'], { unique: true })
export class GroupFeePeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  /**
   * Narx kuchga kiradigan oy (DATE, oyning 1-sanasi). Inclusive.
   */
  @Column({ type: 'date' })
  fromMonth: Date;

  /**
   * Shu oydan boshlab amal qiladigan to'liq oylik narx.
   */
  @Column({ type: 'numeric', default: 0 })
  monthlyFee: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
