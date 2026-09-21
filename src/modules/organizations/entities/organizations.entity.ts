import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Subscription } from '@/modules/subscriptions/entities/subscriptions.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Role } from '@/modules/roles/entities/role.entity';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: false })
  isVip: boolean;

  @OneToMany(() => Center, (center) => center.organization)
  centers: Center[];

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => Subscription, (subscription) => subscription.organization)
  subscriptions: Subscription[];

  /** Shu markazning o'z rollari (registratsiyada seed qilinadi) */
  @OneToMany(() => Role, (role) => role.organization)
  roles: Role[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
