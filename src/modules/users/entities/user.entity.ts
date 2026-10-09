import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Role } from '@/modules/roles/entities/role.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { IsNotEmpty, IsString, Min } from 'class-validator';

@Entity('users')
// Telefon faqat xodimlar orasida unique. O'quvchi akkauntlari (role=student)
// bir xil raqamga ega bo'lishi mumkin — bir oiladan bir nechta o'quvchi.
@Index('UQ_users_phone_staff', ['phone'], {
  unique: true,
  where: `"role" <> 'student'`,
})
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  @Column({ unique: true })
  @Min(6)
  login: string;

  @Column()
  phone: string;

  @Exclude()
  @Column({ select: false })
  password: string;

  /**
   * Rol "turi" — biznes-mantiq uchun (teacher guruhga biriktiriladi va foiz oladi,
   * admin — markaz egasi). Ruxsatlarga aloqasi yo'q: ular `userRole.permissions`
   * dan keladi. Bu ustun har doim `userRole.baseRole` bilan sinxron saqlanadi.
   */
  @Column({ type: 'enum', enum: UserRole, default: UserRole.ADMIN })
  role: UserRole;

  /** Dinamik rol — foydalanuvchining ruxsatlari shundan olinadi */
  @ManyToOne(() => Role, (role) => role.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  userRole: Role;

  /**
   * Bloklangan xodim (`false`) tizimga kira olmaydi, lekin tarixi (oyliklar,
   * komissiya, qabul qilgan cheklari) saqlanadi. Ishdan ketgan xodim
   * o'chirilmaydi — bloklanadi.
   */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  salary: number;

  @Column({ nullable: true })
  commissionPercentage: number;

  @OneToOne(() => Student, (student) => student.user, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  student: Student;

  @ManyToOne(() => Center, (center) => center.users, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  organization: Organization;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
