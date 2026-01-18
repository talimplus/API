import { PartialType } from '@nestjs/mapped-types';
import { CreateLeadDto } from '@/modules/leads/dto/create-lead.dto';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

