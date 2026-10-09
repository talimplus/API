import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { User } from '@/modules/users/entities/user.entity';

/**
 * Ishga nomzod (HR): ish so'rab kelgan yoki markaz o'zi topgan odam.
 *
 * Xodim (`users`) emas — tizimga kirmaydi, oylik olmaydi. Faqat bazada
 * saqlanadi va kerak bo'lganda qo'ng'iroq qilinadi. Telefon unique emas:
 * bir odam bir necha marta murojaat qilishi mumkin.
 */
@Entity('candidates')
@Index('IDX_candidates_org_center', ['organizationId', 'centerId'])
export class Candidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  organizationId: number;

  @Column()
  centerId: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
  phone: string;

  /** Ish tajribasi — erkin matn ("3 yil, 21-maktab"). */
  @Column({ type: 'text' })
  experience: string;

  @Column({ type: 'int' })
  birthYear: number;

  @ManyToOne(() => Subject, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'subjectId' })
  subject?: Subject | null;

  @Column({ type: 'int', nullable: true })
  subjectId?: number | null;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User | null;

  @Column({ type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
