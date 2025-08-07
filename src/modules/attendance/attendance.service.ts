import { UpdateAttendanceDto } from '@/modules/attendance/dto/update-attendance.dto';
import { CreateAttendanceDto } from '@/modules/attendance/dto/create-attendance.dto';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,

    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,

    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
  ) {}

  async create(dtos: CreateAttendanceDto[]) {
    const attendances = [];

    for (const dto of dtos) {
      const student = await this.studentRepo.findOneBy({ id: dto.studentId });
      if (!student)
        throw new NotFoundException(
          `Student not found with ID ${dto.studentId}`,
        );

      const group = await this.groupRepo.findOneBy({ id: dto.groupId });
      if (!group)
        throw new NotFoundException(`Group not found with ID ${dto.groupId}`);

      const attendance = this.attendanceRepo.create({
        date: new Date(dto.date),
        isPresent: dto.isPresent,
        reason: dto.reason,
        student,
        group,
      });

      attendances.push(attendance);
    }

    return this.attendanceRepo.save(attendances);
  }

  async update(id: number, dto: UpdateAttendanceDto) {
    const attendance = await this.attendanceRepo.findOneBy({ id });
    if (!attendance) throw new NotFoundException('Attendance not found');

    attendance.isPresent = dto.isPresent;
    attendance.reason = dto.reason;

    return this.attendanceRepo.save(attendance);
  }

  async findByGroupAndDate(groupId: number, date: string) {
    return this.attendanceRepo.find({
      where: {
        group: { id: groupId },
        date: new Date(date),
      },
      relations: ['student', 'group'],
    });
  }
}
