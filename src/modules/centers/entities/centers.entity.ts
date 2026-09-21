import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('centers')
export class Center {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: false })
  isDefault: boolean;

  /** Barcha "bugun/ish kuni" hisoblari shu zonada (guruh timezone'iga o'xshash) */
  @Column({ default: 'Asia/Tashkent' })
  timezone: string;

  // ── Xodim davomati uchun sozlamalar ────────────────────────────
  // Bular bo'sh bo'lsa davomat baribir yig'iladi, lekin tekshirib
  // bo'lmagani uchun yozuvlar "center_not_configured" bayrog'i bilan keladi.

  /** Markaz binosining koordinatasi (xaritadan belgilanadi) */
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

  /** Shu radius ichidan bosilgan "Keldim" joylashuv bo'yicha to'g'ri hisoblanadi */
  @Column({ type: 'int', default: 150 })
  checkInRadiusMeters: number;

  /**
   * Markaz Wi-Fi'sining tashqi (public) IP manzili — eng ishonchli langar,
   * chunki unga faqat bino ichidan ulanib bo'ladi. `POST /centers/:id/capture-ip`
   * orqali markazdan turib bir tugma bilan yoziladi.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  publicIp: string | null;

  @ManyToOne(() => Organization, (organization) => organization.centers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ nullable: true })
  organizationId: number | null;

  @OneToMany(() => User, (user) => user.center)
  users: User[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
