import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from './entities/subjects.entity';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { Center } from '@/modules/centers/entities/centers.entity';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
  ) {}

  async create(dto: CreateSubjectDto, centerId: number) {
    if (!centerId && !dto.centerId) {
      throw new NotFoundException('Bunday center mavjud emas');
    }
    if (!centerId) centerId = dto.centerId;
    const center = await this.centerRepo.findOneBy({ id: centerId });
    if (!center) {
      throw new NotFoundException('Bunday center mavjud emas');
    }

    const subject = this.subjectRepo.create({
      name: dto.name,
      center,
    });

    return this.subjectRepo.save(subject);
  }

  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      page = 1,
      perPage = 10,
    }: {
      centerId?: number;
      name?: string;
      page?: number;
      perPage?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.subjectRepo
      .createQueryBuilder('subject')
      .leftJoinAndSelect('subject.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (name) {
      query.andWhere('subject.name ILIKE :name', { name: `%${name}%` });
    }

    const [data, total] = await query
      .orderBy('subject.createdAt', 'DESC')
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
    const subject = await this.subjectRepo.findOne({
      where: { id, center: { id: centerId } },
    });
    if (!subject) throw new NotFoundException('Fan topilmadi');
    return subject;
  }

  async update(id: number, dto: UpdateSubjectDto, centerId: number) {
    const subject = await this.findOne(id, centerId);
    Object.assign(subject, dto);
    return this.subjectRepo.save(subject);
  }

  async remove(id: number, centerId: number) {
    const subject = await this.findOne(id, centerId);
    return this.subjectRepo.remove(subject);
  }
}
