import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';

/**
 * Dinamik rol.
 *
 * Har bir organization o'zining rollarini yaratadi. `admin` roli registratsiyada
 * avtomatik yaratiladi va o'zgartirilmaydi (`isLocked`), qolganlari to'liq
 * tahrirlanadi.
 */
@Entity('roles')
@Index(['organization', 'key'], { unique: true })
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  /** Organization ichida unikal slug: `admin`, `manager`, `kassir`, ... */
  @Column()
  key: string;

  /** UI'da ko'rinadigan nom */
  @Column()
  name: string;

  /**
   * Biznes-mantiq uchun "tur". Ruxsatlarga aloqasi yo'q, lekin ba'zi joylarda
   * rol turi muhim: `teacher` — guruhga biriktiriladi va foiz oladi,
   * `admin` — organization egasi.
   */
  @Column({ type: 'enum', enum: UserRole, default: UserRole.OTHER })
  baseRole: UserRole;

  /**
   * Ruxsat kalitlari ro'yxati. `['*']` — barcha ruxsatlar (faqat admin).
   * Postgres `text[]` sifatida saqlanadi.
   */
  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  permissions: string[];

  /** Seed qilingan tizim roli (o'chirib bo'lmaydi, lekin ruxsatlari tahrirlanadi) */
  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  /** Butunlay qulflangan (admin roli): na tahrirlash, na o'chirish mumkin */
  @Column({ type: 'boolean', default: false })
  isLocked: boolean;

  @ManyToOne(() => Organization, (org) => org.roles, { onDelete: 'CASCADE' })
  organization: Organization;

  @OneToMany(() => User, (user) => user.userRole)
  users: User[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
