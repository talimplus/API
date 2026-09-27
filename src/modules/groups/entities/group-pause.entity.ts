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
 * Guruhning vaqtincha to'xtatilgan davri (ta'til, o'qituvchi kasal, guruhda
 * o'quvchi qolmadi va h.k.).
 *
 * `[fromDate .. toDate]` (inclusive) oralig'idagi darslar O'TKAZILMAYDI:
 * jurnalda ko'rinmaydi, ularga davomat yozilmaydi, o'qituvchi kechikishi
 * hisoblanmaydi va o'quvchi ular uchun TO'LAMAYDI — oylik narx to'xtatilgan
 * darslar ulushiga kamayadi (`lessonsPlanned` o'zgarmaydi, `lessonsBillable`
 * kamayadi).
 */
@Entity('group_pauses')
@Index(['groupId', 'fromDate'])
export class GroupPause {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Group, (group) => group.pauses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  @Column({ type: 'date' })
  fromDate: Date;

  @Column({ type: 'date' })
  toDate: Date;

  @Column({ type: 'text' })
  reason: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User | null;

  @Column({ type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
