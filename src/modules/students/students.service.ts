import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { CentersService } from '@/modules/centers/centers.service';
import { Group } from '@/modules/groups/entities/groups.entity';
import { UsersService } from '@/modules/users/users.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { Student } from './entities/students.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { instanceToPlain } from 'class-transformer';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { In } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly centerService: CentersService,
    private readonly userService: UsersService,
    private readonly organizationsService: OrganizationsService,
    @Inject(forwardRef(() => ReferralsService))
    private readonly referralsService: ReferralsService,
  ) {}
  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      phone,
      status,
      page = 1,
      perPage = 10,
      groupId,
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      page?: number;
      status: StudentStatus;
      perPage?: number;
      groupId?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) query.andWhere('center.id = :centerId', { centerId });
    if (name) {
      query.andWhere(
        '(student.firstName ILIKE :name OR student.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (status) {
      query.andWhere('student.status = :status', { status });
    }

    if (phone)
      query.andWhere('student.phone ILIKE :phone', { phone: `%${phone}%` });

    if (groupId) query.andWhere('student.groupId = :groupId', { groupId });

    const [data, total] = await query
      .orderBy('student.createdAt', 'DESC')
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

  async getReferredStudents(organizationId: number, centerId?: number) {
    console.log(organizationId);
    console.log(centerId);
    const query = this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('student.status IN (:...statuses)', {
        statuses: [StudentStatus.NEW, StudentStatus.ACTIVE],
      });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    const students = await query.orderBy('student.createdAt', 'DESC').getMany();

    return instanceToPlain(students);
  }

  async findById(id: number) {
    return this.studentRepo.findOne({
      where: { id },
      relations: ['user', 'center'],
    });
  }

  async findByActiveStatus(): Promise<Student[]> {
    return await this.studentRepo.find({
      where: { status: StudentStatus.ACTIVE },
      relations: ['group', 'center'],
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

    const groupIds = dto.groupIds;

    const groups = await this.groupRepo.findBy({ id: In(groupIds) });

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
      monthlyFee: dto.monthlyFee,
      referralDiscount: 0,
      birthDate: dto.birthDate,
      status: StudentStatus.NEW,
      center,
      user,
      groups: groups,
    });

    const savedStudent = await this.studentRepo.save(student);

    if (dto.referrerId) {
      const referrer = await this.studentRepo.findOneBy({ id: dto.referrerId });
      if (!referrer) {
        throw new BadRequestException('Taklif qilgan o‘quvchi topilmadi');
      }

      await this.referralsService.create(referrer.id, savedStudent.id);
    }

    return instanceToPlain(savedStudent);
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
