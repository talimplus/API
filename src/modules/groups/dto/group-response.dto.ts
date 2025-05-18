import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '@/modules/users/dto/user-response.dto';
import { SubjectResponseDto } from '@/modules/subjects/dto/subject-response.dto';
import { CenterResponseDto } from '@/modules/centers/dto/center-reponse.dto';

export class GroupResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ingliz tili guruh 1' })
  name: string;

  @ApiProperty({ example: 400000 })
  monthlyFee: number;

  @ApiProperty({ type: () => SubjectResponseDto, nullable: true })
  subject: SubjectResponseDto;

  @ApiProperty({ type: () => UserResponseDto, nullable: true })
  teacher: UserResponseDto;

  @ApiProperty({ type: () => CenterResponseDto, nullable: true })
  center: CenterResponseDto;
}
