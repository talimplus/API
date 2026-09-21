import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { CreateUserDto } from '@/modules/users/dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from '@/modules/users/dto/update-user.dto';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { CurrentUser } from '@/common/types/current.user';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { instanceToPlain } from 'class-transformer';
import { UpdateMyProfileDto } from '@/modules/users/dto/update-my-profile.dto';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { RolesService } from '@/modules/roles/roles.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly rolesService: RolesService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
  ) {}

  async createAdminUser(data: Partial<User>, organization: Organization) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = this.userRepo.create({
      ...data,
      password: hashedPassword,
      role: UserRole.ADMIN,
      organization,
    });
    return this.userRepo.save(user);
  }

  async create(dto: CreateUserDto, organizationId: number, role?: UserRole) {
    if (role === UserRole.ADMIN && !dto.centerId)
      throw new BadRequestException('Admin uchun centerId bo‘lishi kerak');

    // Rol dinamik: `roleId` bo'yicha (yoki eski `role` enum'i bo'yicha) topiladi.
    // Administrator rolini biriktirib bo'lmaydi — u markaz egasiniki.
    const userRole = await this.rolesService.resolveRoleForUser(
      organizationId,
      dto.roleId,
      dto.role,
    );

    const existingUser = await this.userRepo.findOne({
      where: { login: dto.login },
    });

    if (existingUser) {
      throw new ValidationException({
        login: 'Bunday login allaqachon mavjud',
      });
    }

    // `users.phone` is globally unique (db constraint). Catch early to return a clear 400 error
    // instead of an unhandled QueryFailedError.
    const existingByPhone = await this.userRepo.findOne({
      where: { phone: dto.phone },
    });
    if (existingByPhone) {
      throw new ValidationException({
        phone: 'Bunday phone allaqachon mavjud',
      });
    }

    const organization =
      await this.organizationsService.findById(organizationId);

    if (!organization.id) {
      throw new BadRequestException('Bunday organization mavjud emas');
    }
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let center = null;

    if (dto.centerId) {
      center = await this.centerRepo.findOne({ where: { id: dto.centerId } });

      if (!center) {
        throw new BadRequestException('Bunday center mavjud emas');
      }
    }

    const rest = { ...dto };
    delete rest.roleId;

    const user = this.userRepo.create({
      ...rest,
      // `users.role` har doim rol turi bilan sinxron
      role: userRole.baseRole,
      userRole,
      password: hashedPassword,
      center,
      organization,
    });

    return this.userRepo.save(user);
  }

  async update(id: number, dto: UpdateUserDto, organizationId?: number) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');

    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    const { roleId, role, ...rest } = dto;
    Object.assign(user, rest);

    // Rolni almashtirish: ruxsatlar darhol yangi roldan o'qiladi
    if (roleId !== undefined || role !== undefined) {
      if (user.role === UserRole.ADMIN) {
        throw new BadRequestException(
          'Administratorning rolini o‘zgartirib bo‘lmaydi',
        );
      }

      const newRole = await this.rolesService.resolveRoleForUser(
        organizationId ?? (await this.resolveOrganizationId(user.id)),
        roleId,
        role,
      );

      user.userRole = newRole;
      user.role = newRole.baseRole;
      this.rolesService.invalidateCache(user.id);
    }

    return this.userRepo.save(user);
  }

  /** Eski chaqiruvlar uchun: userning organization id'sini topadi. */
  private async resolveOrganizationId(userId: number): Promise<number> {
    const row = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['organization'],
    });
    if (!row?.organization?.id) {
      throw new BadRequestException('Foydalanuvchining markazi topilmadi');
    }
    return row.organization.id;
  }

  async findByLogin(login: string) {
    return this.userRepo.findOne({ where: { login } });
  }

  async findAll(
    organizationId: number,
    {
      centerId,
      role,
      name,
      phone,
      page = 1,
      perPage = 10,
    }: {
      centerId?: number;
      role?: UserRole;
      name?: string;
      phone?: string;
      page?: number;
      perPage?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.center', 'center')
      .leftJoinAndSelect('user.userRole', 'userRole')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (role !== undefined) {
      if (!Object.values(UserRole).includes(role)) {
        throw new BadRequestException('role is invalid');
      }
      query.andWhere('user.role = :role', { role });
    }

    if (name) {
      query.andWhere(
        '(user.firstName ILIKE :name OR user.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (phone) {
      query.andWhere('user.phone ILIKE :phone', { phone: `%${phone}%` });
    }

    const [data, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data: instanceToPlain(data),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * 👩‍🏫 O'qituvchilar ro'yxati (paginatsiyasiz) — filter/select uchun.
   */
  async getAllTeachers(
    organizationId: number,
    { centerId, name }: { centerId?: number; name?: string } = {},
  ) {
    const query = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('user.role = :role', { role: UserRole.TEACHER });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (name) {
      query.andWhere(
        '(user.firstName ILIKE :name OR user.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    const data = await query
      .orderBy('user.firstName', 'ASC')
      .addOrderBy('user.lastName', 'ASC')
      .getMany();

    return instanceToPlain(data);
  }

  async getMe(userId: number) {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.center', 'center')
      .leftJoinAndSelect('user.organization', 'organization')
      .leftJoinAndSelect('user.userRole', 'userRole')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');

    const out: any = instanceToPlain(user);
    out.centerId = (user as any).center?.id ?? null;
    out.organizationId = (user as any).organization?.id ?? null;
    out.roleId = (user as any).userRole?.id ?? null;
    out.roleName = (user as any).userRole?.name ?? null;
    return out;
  }

  async updateMe(userId: number, dto: UpdateMyProfileDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['center', 'organization'],
    });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');

    if (dto.login && dto.login !== user.login) {
      const exists = await this.userRepo.findOne({
        where: { login: dto.login },
      });
      if (exists && exists.id !== user.id) {
        throw new ValidationException({
          login: 'Bunday login allaqachon mavjud',
        });
      }
      user.login = dto.login;
    }

    if (dto.phone && dto.phone !== user.phone) {
      const exists = await this.userRepo.findOne({
        where: { phone: dto.phone },
      });
      if (exists && exists.id !== user.id) {
        throw new ValidationException({
          phone: 'Bunday phone allaqachon mavjud',
        });
      }
      user.phone = dto.phone;
    }

    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;

    if (dto.password) {
      user.password = await bcrypt.hash(dto.password, 10);
    }

    await this.userRepo.save(user);
    return this.getMe(user.id);
  }

  /**
   * Ishchilar (studentsiz userlar): teacher/manager/other.
   * Frontend selectlar (teacher tanlash, xodimlar ro'yxati) uchun ishlatiladi.
   */
  async findEmployees(
    organizationId: number,
    {
      centerId,
      name,
      phone,
      page = 1,
      perPage = 10,
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      page?: number;
      perPage?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.center', 'center')
      .leftJoinAndSelect('user.userRole', 'userRole')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('user.role IN (:...roles)', {
        roles: [
          UserRole.TEACHER,
          UserRole.MANAGER,
          UserRole.RECEPTION,
          UserRole.OTHER,
        ],
      });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (name) {
      query.andWhere(
        '(user.firstName ILIKE :name OR user.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (phone) {
      query.andWhere('user.phone ILIKE :phone', { phone: `%${phone}%` });
    }

    const [data, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data: instanceToPlain(data),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: number) {
    const user = await this.userRepo.findOne({
      where: { id },
    });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    return instanceToPlain(user);
  }

  async remove(id: number, currentUser: CurrentUser) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['center', 'organization'],
    });

    if (user.id === currentUser?.userId) {
      throw new BadRequestException("Siz o'zingizni o‘chira olmaysiz");
    }

    if (user.organization.id !== currentUser?.organizationId) {
      throw new ForbiddenException('Siz bu foydalanuvchini o‘chira olmaysiz');
    }

    if (user.role === UserRole.ADMIN) {
      const organizationId = user.center.organization.id;

      // Avval organizationni o‘chiramiz (CASCADE bo‘yicha center va userlar o‘chadi)
      await this.organizationRepo.delete(organizationId);

      return {
        message: 'Admin va unga tegishli barcha maʼlumotlar o‘chirildi',
      };
    }

    this.rolesService.invalidateCache(user.id);
    return this.userRepo.remove(user);
  }

  async findByEmailWithCenterOrg(login: string) {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password') // parolni qo‘shyapmiz
      .leftJoinAndSelect('user.center', 'center')
      .leftJoinAndSelect('center.organization', 'centerOrg')
      .leftJoinAndSelect('user.organization', 'organization')
      .leftJoinAndSelect('user.userRole', 'userRole')
      .where('user.login = :login', { login })
      .getOne();
  }
}
