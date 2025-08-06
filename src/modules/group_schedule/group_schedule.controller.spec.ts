import { Test, TestingModule } from '@nestjs/testing';
import { GroupScheduleController } from './group_schedule.controller';

describe('GroupScheduleController', () => {
  let controller: GroupScheduleController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupScheduleController],
    }).compile();

    controller = module.get<GroupScheduleController>(GroupScheduleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
