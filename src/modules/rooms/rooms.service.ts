import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/rooms.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Center } from '@/modules/centers/entities/centers.entity';

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
  ) {}

  async create(dto: CreateRoomDto, centerId: number) {
    if (!centerId && !dto.centerId) {
      throw new NotFoundException('Bunday xona mavjud emas');
    }
    if (!centerId) centerId = dto.centerId;
    const center = await this.centerRepo.findOneBy({ id: centerId });
    if (!center) {
      throw new NotFoundException('Bunday xona mavjud emas');
    }

    const room = this.roomRepo.create({
      name: dto.name,
      center,
    });

    return this.roomRepo.save(room);
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

    const query = this.roomRepo
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    if (name) {
      query.andWhere('room.name ILIKE :name', { name: `%${name}%` });
    }

    const [data, total] = await query
      .orderBy('room.createdAt', 'DESC')
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
    const room = await this.roomRepo.findOne({
      where: { id, center: { id: centerId } },
    });
    if (!room) throw new NotFoundException('Xona topilmadi');
    return room;
  }

  async update(id: number, dto: UpdateRoomDto, centerId: number) {
    const room = await this.findOne(id, centerId);
    if (dto.centerId) {
      const center = await this.centerRepo.findOne({
        where: { id: dto.centerId },
      });
      if (!center) {
        throw new NotFoundException('Yangi Xona topilmadi');
      }
      room.center = center;
    }

    if (dto.name) {
      room.name = dto.name;
    }
    return this.roomRepo.save(room);
  }

  async remove(id: number, centerId: number) {
    const room = await this.findOne(id, centerId);
    return this.roomRepo.remove(room);
  }
}
