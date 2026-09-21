import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';

/**
 * Ota-onaning Telegram chati ↔ o'quvchi bog'lanishi.
 *
 * Bitta o'quvchiga bir nechta chat ulanishi mumkin (ota, ona, amaki...) —
 * QR bitta, uni kim skaner qilsa o'sha ulanadi. Ulanish uzilganda qator
 * **o'chirilmaydi**, `isActive = false` qilinadi: tarix va "kim ulangan edi"
 * degan savol uchun kerak.
 */
@Entity('telegram_parent_links')
@Index(['studentId', 'chatId'], { unique: true })
export class TelegramParentLink {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  /**
   * O'quvchining tashkiloti (student → center → organization nusxasi).
   * Bot xabarni qaysi tashkilot nomidan olganini tez tekshirish uchun:
   * A markazning QR kodi B markazning botiga ulanmasligi kerak.
   */
  @Column({ type: 'int', nullable: true })
  organizationId?: number | null;

  /** Telegram chat id — bigint bo'lgani uchun string sifatida saqlanadi */
  @Column({ type: 'varchar', length: 32 })
  chatId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  telegramUserId?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  firstName?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  lastName?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username?: string | null;

  /** Telegram profilidagi til — xabar shu tilda yuboriladi (uz/ru) */
  @Column({ type: 'varchar', length: 8, nullable: true })
  languageCode?: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  linkedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  unlinkedAt?: Date | null;

  /** Botni bloklagan yoki chat o'chirilgan — shundan keyin yuborilmaydi */
  @Column({ type: 'timestamp', nullable: true })
  blockedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastNotifiedAt?: Date | null;
}
