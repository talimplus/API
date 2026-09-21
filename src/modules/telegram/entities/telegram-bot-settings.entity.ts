import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';

/**
 * Ota-onalar boti sozlamalari — har bir tashkilot uchun bitta qator.
 *
 * Qoida: **to'lov xabari yoqilgan (default)**, qolganlari o'chiq. Ya'ni bot
 * ulangan zahoti ota-onaga faqat pul harakati haqida xabar boradi; davomat va
 * qarz eslatmalarini markaz o'zi ataylab yoqishi kerak.
 */
@Entity('telegram_bot_settings')
export class TelegramBotSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ unique: true })
  organizationId: number;

  /**
   * Tashkilotning **o'z** bot tokeni (@BotFather). Bo'sh bo'lsa bu tashkilot
   * uchun bot umuman ishga tushmaydi. Frontga hech qachon ochiq qaytarilmaydi.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  botToken?: string | null;

  /** Token saqlanayotganda `getMe()` dan olinadi — qo'lda kiritilmaydi */
  @Column({ type: 'varchar', length: 64, nullable: true })
  botUsername?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  botTokenUpdatedAt?: Date | null;

  /** Umumiy kalit — o'chirilsa hech qanday xabar yuborilmaydi */
  @Column({ default: true })
  isEnabled: boolean;

  /** Pul qabul qilinganda (chek yaratilganda, tasdiqdan oldin) */
  @Column({ default: true })
  notifyPaymentReceived: boolean;

  /** Admin chekni tasdiqlaganda */
  @Column({ default: false })
  notifyPaymentConfirmed: boolean;

  /** O'quvchi darsga kelmaganda (absent/late) */
  @Column({ default: false })
  notifyAbsence: boolean;

  /** Oyning belgilangan kunida to'lanmagan qarz bo'yicha eslatma */
  @Column({ default: false })
  notifyDebt: boolean;

  /** Qarz eslatmasi yuboriladigan kun (1..28). Default — to'lov muddati (10) */
  @Column({ type: 'int', default: 10 })
  debtReminderDay: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
