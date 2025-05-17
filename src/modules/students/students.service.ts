import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { CentersService } from '@/modules/centers/centers.service';
import { GroupsService } from '@/modules/groups/groups.service';
import { UsersService } from '@/modules/users/users.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { Student } from './entities/students.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly centerService: CentersService,
    private readonly groupService: GroupsService,
    private readonly userService: UsersService,
    private readonly organizationsService: OrganizationsService,
  ) {}
  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      phone,
      page = 1,
      perPage = 10,
      groupId,
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      page?: number;
      perPage?: number;
      groupId?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.user', 'user')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) query.andWhere('center.id = :centerId', { centerId });
    if (name) {
      query.andWhere(
        '(user.firstName ILIKE :name OR user.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }
    if (phone)
      query.andWhere('user.phone ILIKE :phone', { phone: `%${phone}%` });

    if (groupId) query.andWhere('student.groupId = :groupId', { groupId });

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

  async findById(id: number) {
    return this.studentRepo.findOne({
      where: { id },
      relations: ['user', 'center'],
    });
  }

  async create(
    dto: CreateStudentDto,
    centerId: number,
    organizationId: number,
    role: UserRole,
  ) {
    const center = await this.centerService.findOne(centerId);
    if (!center) throw new NotFoundException('Bunday center mavjud emas');
    const organization =
      await this.organizationsService.findById(organizationId);

    if (!organization.id) {
      throw new BadRequestException('Bunday organizatsiya mavjud emas');
    }

    const group = await this.groupService.findOne(dto.groupId);

    if (!group) {
      throw new BadRequestException('Bunday guruh mavjud emas');
    }

    const user = await this.userService.create(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        login: dto.login,
        phone: dto.phone,
        password: dto.password,
        role: UserRole.STUDENT,
        centerId: centerId || dto.centerId,
      },
      organizationId,
      role,
    );

    if (!user) throw new BadRequestException('Nomalum xatolik');

    const student = this.studentRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      birthDate: dto.birthDate,
      status: StudentStatus.NEW,
      center,
      user,
      group,
    });

    return this.studentRepo.save(student);
  }

  async update(id: number, dto: UpdateStudentDto) {
    const student = await this.findById(id);
    const user = await this.userService.findOne(student.user.id);
    if (!user)
      throw new BadRequestException('Bunday foydalanuvchi mavjud emas');

    if (dto.password) {
      if (dto.password) {
        dto.password = await bcrypt.hash(dto.password, 10);
      }
    }

    const updatedUser = await this.userService.update(user.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      login: dto.login,
      phone: dto.phone,
      centerId: dto.centerId,
      password: dto.password,
    });

    if (!updatedUser)
      throw new BadRequestException(
        "Bunday foydalanuvchi mavjud emas Yoki nomalum Xato ro'y berdi",
      );

    Object.assign(student, dto);
    return instanceToPlain(this.studentRepo.save(student));
  }

  async changeStatus(id: number, status: StudentStatus) {
    const student = await this.findById(id);
    student.status = status;
    return this.studentRepo.save(student);
  }
}
