import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';

/**
 * Bayram / dam olish kunlari (`[fromDate .. toDate]`, inclusive).
 *
 * Bu kunlarda HECH BIR guruhda dars bo'lmaydi: jurnalda ko'rinmaydi, davomat
 * yozilmaydi, o'qituvchi kechikishi hisoblanmaydi. To'lovda bayram darslari
 * rejadagi darslardan ham, to'lanadiganlardan ham chiqariladi — ya'ni oylik
 * narx O'ZGARMAYDI (to'liq oy o'qigan o'quvchi to'liq to'laydi). Narx kamayishi
 * kerak bo'lgan to'xtatish uchun guruh pauzasi (`group_pauses`) bor.
 *
 * `centerId = null` — butun tashkilot (barcha filiallar) uchun.
 */
@Entity('holidays')
@Index(['organizationId', 'fromDate'])
export class Holiday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  organizationId: number;

  @Column({ type: 'int', nullable: true })
  centerId: number | null;

  @Column({ type: 'date' })
  fromDate: Date;

  @Column({ type: 'date' })
  toDate: Date;

  @Column({ type: 'text' })
  name: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User | null;

  @Column({ type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
