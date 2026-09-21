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
import { Group } from '@/modules/groups/entities/groups.entity';

/**
 * O'quvchining bitta guruhdagi **a'zolik oynasi**.
 *
 * `students_groups_groups` (many-to-many) — joriy a'zolik, o'quvchi chiqarilsa
 * o'chadi. Bu jadval esa tarixni saqlaydi va to'lov hisobining chegaralarini
 * beradi:
 *  - `joinedAt` — **inclusive**: o'sha kungi dars to'lovga kiradi;
 *  - `leftAt`   — **exclusive**: o'sha kungi dars to'lovga KIRMAYDI.
 *
 * Shu qoida tufayli oy o'rtasida A dan B ga o'tgan o'quvchi bir oy uchun
 * ikki marta to'lamaydi: A `leftAt` gacha, B `joinedAt` dan hisoblanadi.
 */
@Entity('student_group_enrollments')
@Index(['studentId', 'groupId', 'joinedAt'])
@Index(['groupId', 'leftAt'])
export class StudentGroupEnrollment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student?: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group?: Group;

  @Column()
  groupId: number;

  /** Guruhga qo'shilgan sana (YYYY-MM-DD), inclusive. */
  @Column({ type: 'date' })
  joinedAt: string;

  /** Guruhdan chiqqan sana (YYYY-MM-DD), exclusive. null — hali a'zo. */
  @Column({ type: 'date', nullable: true })
  leftAt?: string | null;

  /** Chiqish sababi (ko'chirish izohi, guruh yopilgani va h.k.). */
  @Column({ type: 'text', nullable: true })
  leftReason?: string | null;

  /** Ko'chirish bo'lsa — qaysi guruhga ketgani. */
  @Column({ type: 'int', nullable: true })
  transferredToGroupId?: number | null;

  /** Ko'chirish bo'lsa — qaysi guruhdan kelgani. */
  @Column({ type: 'int', nullable: true })
  transferredFromGroupId?: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
