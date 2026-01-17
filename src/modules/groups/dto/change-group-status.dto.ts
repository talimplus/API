import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

export class ChangeGroupStatusDto {
  @ApiProperty({ enum: GroupStatus, example: GroupStatus.STARTED })
  @IsEnum(GroupStatus)
  status: GroupStatus;
}

