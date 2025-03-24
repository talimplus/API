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
import { Roles } from '@/decorators/roles.decorator';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from '@/modules/users/dto/update-user.dto';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { CurrentUser } from '@/common/types/current.user';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
  ) {}

  async createAdminUser(data: Partial<User>, organization: Organization) {
    console.log(organization, 'createAdminUser');
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = this.userRepo.create({
      ...data,
      password: hashedPassword,
      role: UserRole.ADMIN,
      organization,
    });
    return this.userRepo.save(user);
  }

  async create(dto: CreateUserDto) {
    if (
      ![UserRole.TEACHER, UserRole.MANAGER, UserRole.OTHER].includes(dto.role)
    ) {
      throw new BadRequestException(
        'Faqat teacher, manager yoki other rollar mumkin',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let center = null;

    if (dto.centerId) {
      center = await this.centerRepo.findOne({ where: { id: dto.centerId } });

      if (!center) {
        throw new BadRequestException('Bunday center mavjud emas');
      }
    }

    const user = this.userRepo.create({
      ...dto,
      password: hashedPassword,
      center,
    });

    return this.userRepo.save(user);
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findOne(id, dto.centerId);

    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    Object.assign(user, dto);
    return this.userRepo.save(user);
  }

  async findByEmail(email: string) {
    return this.userRepo.findOne({ where: { email } });
  }

  async findAll(
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
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

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
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: number, centerId: number) {
    const user = await this.userRepo.findOne({
      where: { id, center: { id: centerId } },
    });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    return user;
  }

  @Roles(UserRole.ADMIN)
  async remove(id: number, centerId: number, currentUser: CurrentUser) {
    const user = await this.userRepo.findOne({
      where: { id, center: { id: centerId } },
      relations: ['center', 'center.organization'],
    });

    if (user.id === currentUser?.userId) {
      throw new BadRequestException("Siz o'zingizni o‘chira olmaysiz");
    }

    if (user.center.organization.id !== currentUser?.organizationId) {
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

    return this.userRepo.remove(user);
  }

  async findByEmailWithCenterOrg(email: string) {
    return this.userRepo.findOne({
      where: { email },
      relations: ['organization', 'center', 'center.organization'],
    });
  }
}
