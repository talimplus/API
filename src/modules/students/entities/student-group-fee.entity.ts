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
 * O'quvchining SHU GURUHDAGI shaxsiy oylik narxi — oy aniqligida (2026-11-20).
 *
 * To'lovlar uchun shaxsiy narxning YAGONA MANBASI. `students.monthlyFee` —
 * faqat eski front uchun nusxa (hamma guruhda bir xil bo'lsa o'sha, aks holda 0).
 *
 * Ustun nomi `fromMonth`, lekin u SANA: oy o'rtasi ham bo'lishi mumkin
 * (2026-11-24) — har dars o'z sanasidagi narxda hisoblanadi.
 *
 * Dars sanasi uchun narx — `fromMonth <= sana` ga mos eng oxirgi qator, bo'lmasa eng
 * birinchisi; qator yo'q — 0 (guruh narxi). `monthlyFee = 0` — guruh narxi.
 */
@Entity('student_group_fees')
@Index(['studentId', 'groupId', 'fromMonth'], { unique: true })
export class StudentGroupFee {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  @Column({ type: 'date' })
  fromMonth: Date;

  @Column({ type: 'numeric', default: 0 })
  monthlyFee: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
