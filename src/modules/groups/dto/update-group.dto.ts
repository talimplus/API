import { PartialType } from '@nestjs/mapped-types';
import { CreateGroupDto } from '@/modules/groups/dto/create-group.dto';

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}
