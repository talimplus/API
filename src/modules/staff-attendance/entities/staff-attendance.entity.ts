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
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import {
  AttendanceConfidence,
  AttendanceSource,
} from '../enums/staff-attendance.enum';

/**
 * Xodimning ishga kelgani (hozircha faqat o'qituvchilar yoqilgan).
 *
 * Kuniga bitta qator: `(userId, workDate)` unique. "Ketdim" (check-out)
 * hozircha yig'ilmaydi — kechikish va kelmaslik statistikasi uchun kerak emas.
 *
 * MUHIM: bu jadval hech narsani **bloklamaydi**. Har bir yozuv o'zi bilan
 * dalil olib keladi (GPS, IP, qurilma) va `confidence` bilan belgilanadi;
 * shubhalilari hisobotda alohida ko'rinadi.
 */
@Entity('staff_attendances')
@Index(['userId', 'workDate'], { unique: true })
@Index(['centerId', 'workDate'])
export class StaffAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'centerId' })
  center: Center;

  @Column({ nullable: true })
  centerId: number | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column()
  organizationId: number;

  /** Ish kuni (markaz timezone'ida), YYYY-MM-DD */
  @Column({ type: 'date' })
  workDate: Date;

  /** "Keldim" bosilgan payt */
  @Column({ type: 'timestamp' })
  checkInAt: Date;

  /**
   * Shu kundagi birinchi darsning boshlanish vaqti (HH:mm:ss).
   * Darsi bo'lmagan kunda `null` — bunday kunda kechikish hisoblanmaydi.
   */
  @Column({ type: 'time', nullable: true })
  firstLessonAt: string | null;

  /** `checkInAt - firstLessonAt`, daqiqada. Erta kelgan bo'lsa 0. */
  @Column({ type: 'int', default: 0 })
  lateMinutes: number;

  @Column({
    type: 'enum',
    enum: AttendanceSource,
    default: AttendanceSource.SELF,
  })
  source: AttendanceSource;

  @Column({
    type: 'enum',
    enum: AttendanceConfidence,
    default: AttendanceConfidence.MEDIUM,
  })
  confidence: AttendanceConfidence;

  // ── Dalillar ────────────────────────────────────────────────────

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

  /** Brauzer bergan GPS xatolik radiusi (metr) */
  @Column({ type: 'int', nullable: true })
  accuracyMeters: number | null;

  /** Markaz koordinatasigacha masofa (metr), hisoblab yoziladi */
  @Column({ type: 'int', nullable: true })
  distanceMeters: number | null;

  /** Markaz radiusi ichidami. Markaz koordinatasi yo'q bo'lsa `null` */
  @Column({ type: 'boolean', nullable: true })
  geoMatched: boolean | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  /** Markaz Wi-Fi'sining public IP'si bilan mos keldimi. Sozlanmagan bo'lsa `null` */
  @Column({ type: 'boolean', nullable: true })
  ipMatched: boolean | null;

  /** Brauzerda generatsiya qilinib localStorage'da saqlanadigan qurilma ID'si */
  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** `AttendanceFlag` qiymatlari */
  @Column({ type: 'simple-array', nullable: true })
  flags: string[] | null;

  // ── Tasdiqlash / izoh ──────────────────────────────────────────

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'confirmedByUserId' })
  confirmedBy: User | null;

  @Column({ nullable: true })
  confirmedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
