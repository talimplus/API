import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Center } from './entities/centers.entity';
import { CreateCenterDto } from './dto/create-center.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import { Organization } from '@/modules/organizations/entities/organizations.entity';

@Injectable()
export class CentersService {
  constructor(
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
  ) {}

  async create(dto: CreateCenterDto, organizationId: number) {
    const organization = await this.orgRepo.findOneBy({ id: organizationId });
    if (!organization) {
      throw new NotFoundException('Organization topilmadi');
    }

    const center = this.centerRepo.create({
      ...dto,
      organization,
    });

    return this.centerRepo.save(center);
  }

  async findAll(
    organizationId: number,
    {
      page = 1,
      perPage = 10,
      name,
    }: {
      page?: number;
      perPage?: number;
      name?: string;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.centerRepo
      .createQueryBuilder('center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (name) {
      query.andWhere('center.name ILIKE :name', { name: `%${name}%` });
    }

    const [data, total] = await query
      .orderBy('center.createdAt', 'DESC')
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

  async findOne(id: number, organizationId: number) {
    const center = await this.centerRepo.findOne({
      where: { id, organization: { id: organizationId } },
    });

    if (!center) {
      throw new NotFoundException('Filial topilmadi');
    }

    return center;
  }

  async update(id: number, dto: UpdateCenterDto, organizationId: number) {
    const center = await this.findOne(id, organizationId);
    Object.assign(center, dto);
    return this.centerRepo.save(center);
  }

  async remove(id: number, organizationId: number) {
    const center = await this.findOne(id, organizationId);
    return this.centerRepo.remove(center);
  }
}
