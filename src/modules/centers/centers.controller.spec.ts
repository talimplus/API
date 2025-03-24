import { Test, TestingModule } from '@nestjs/testing';
import { CentersController } from './centers.controller';

describe('CentersController', () => {
  let controller: CentersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CentersController],
    }).compile();

    controller = module.get<CentersController>(CentersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
