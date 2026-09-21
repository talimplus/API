import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';

/**
 * O'quvchining QR kodidagi maxfiy kalit.
 *
 * QR ichida o'quvchining `id` si EMAS, aynan shu tasodifiy token turadi —
 * aks holda kim bo'lmasin `?start=123` yozib begona o'quvchiga ulanib olardi.
 * Har o'quvchiga bitta qator; QR "chiqib ketgan" bo'lsa token yangilanadi
 * (eski QR shu zahoti ishlamay qoladi, allaqachon ulangan ota-onalar qoladi).
 */
@Entity('telegram_link_tokens')
export class TelegramLinkToken {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column({ unique: true })
  studentId: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  /** Tokenni oxirgi marta yangilagan xodim */
  @Column({ type: 'int', nullable: true })
  rotatedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  rotatedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
