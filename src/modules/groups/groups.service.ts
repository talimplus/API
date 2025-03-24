import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Group } from './entities/groups.entity';
import { Repository } from 'typeorm';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateGroupDto) {
    const center = await this.centerRepo.findOne({
      where: { id: dto.centerId },
    });
    if (!center) throw new NotFoundException('Bunday center mavjud emas');

    const subject = await this.subjectRepo.findOne({
      where: {
        id: dto.subjectId,
        center: { id: dto.centerId },
      },
    });

    if (!subject) {
      throw new BadRequestException(
        'Subject bu markazga tegishli emas yoki mavjud emas',
      );
    }

    let teacher: User = null;
    if (dto.teacherId) {
      teacher = await this.userRepo.findOne({
        where: {
          id: dto.teacherId,
          center: { id: dto.centerId },
        },
      });

      if (!teacher) {
        throw new BadRequestException(
          'Ushbu o‘qituvchi bu markazga tegishli emas yoki mavjud emas',
        );
      }
    }

    const group = this.groupRepo.create({
      name: dto.name,
      center,
      subject,
      teacher,
    });

    return this.groupRepo.save(group);
  }

  async update(id: number, dto: UpdateGroupDto) {
    const group = await this.groupRepo.findOneByOrFail({ id });

    if (dto.name) group.name = dto.name;
    if (dto.subjectId)
      group.subject = await this.subjectRepo.findOneByOrFail({
        id: dto.subjectId,
      });
    if (dto.centerId)
      group.center = await this.centerRepo.findOneByOrFail({
        id: dto.centerId,
      });
    if (dto.teacherId)
      group.teacher = await this.userRepo.findOneByOrFail({
        id: dto.teacherId,
      });

    return this.groupRepo.save(group);
  }

  async findAll(
    role: UserRole,
    organizationId: number,
    centerId?: number,
    name?: string,
    teacherId?: number,
    page?: number,
    perPage?: number,
  ) {
    const currentPage = Number(page) || 1;
    const itemsPerPage = Number(perPage) || 10;
    const skip = (currentPage - 1) * itemsPerPage;

    const query = this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.center', 'center')
      .leftJoinAndSelect('group.subject', 'subject')
      .leftJoinAndSelect('group.teacher', 'teacher')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (role !== UserRole.ADMIN && centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (name) {
      query.andWhere('group.name ILIKE :name', { name: `%${name}%` });
    }

    if (teacherId) {
      query.andWhere('teacher.id = :teacherId', { teacherId });
    }

    const [data, total] = await query
      .orderBy('group.createdAt', 'DESC')
      .skip(skip)
      .take(itemsPerPage)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page: currentPage,
        perPage: itemsPerPage,
        totalPages: Math.ceil(total / itemsPerPage),
      },
    };
  }

  async findOne(id: number) {
    return this.groupRepo.findOne({
      where: { id },
      relations: ['center', 'teacher', 'subject', 'students'],
    });
  }

  async remove(id: number) {
    const group = await this.groupRepo.findOneByOrFail({ id });
    return this.groupRepo.remove(group);
  }
}
