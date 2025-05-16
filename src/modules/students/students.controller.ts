import { Controller } from '@nestjs/common';
import { StudentsService } from '@/modules/students/students.service';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentService: StudentsService) {}
  async create() {}
}
