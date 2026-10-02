import { describe, it, expect } from '@jest/globals';
import {
  BadRequestException,
  Controller,
  Post,
  Body,
  HttpStatus,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import {
  createGlobalValidationPipes,
  standardSchemaConverter,
} from '../index.js';

const PilotPayloadSchema = z.object({
  title: z.string().min(3),
  count: z.number().int().positive(),
  active: z.boolean().default(true),
});

type PilotPayload = z.infer<typeof PilotPayloadSchema>;

@Controller('pilot-validation')
class PilotValidationController {
  @Post()
  execute(@Body({ schema: PilotPayloadSchema }) body: PilotPayload) {
    return { success: true, data: body };
  }
}

describe('NestJS 12 Standard Schema (Zod) Validation Pipeline', () => {
  let controller: PilotValidationController;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [PilotValidationController],
    }).compile();

    controller = moduleRef.get<PilotValidationController>(PilotValidationController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('validates and passes valid payload through the dual validation pipeline', async () => {
    const pipes = createGlobalValidationPipes();
    const rawInput = {
      title: 'Valid Pilot Test',
      count: 42,
    };

    let transformed = rawInput;
    for (const pipe of pipes) {
      transformed = (await pipe.transform(transformed, {
        type: 'body',
        metatype: Object,
        schema: PilotPayloadSchema,
      })) as typeof rawInput;
    }

    expect(transformed).toEqual({
      title: 'Valid Pilot Test',
      count: 42,
      active: true,
    });

    const result = controller.execute(transformed as PilotPayload);
    expect(result).toEqual({
      success: true,
      data: {
        title: 'Valid Pilot Test',
        count: 42,
        active: true,
      },
    });
  });

  it('rejects invalid payload with BadRequestException and structured issues', async () => {
    const pipes = createGlobalValidationPipes();
    const invalidInput = {
      title: 'ab', // Too short (min 3)
      count: -5,  // Not positive
    };

    let caughtError: unknown;
    try {
      let val = invalidInput;
      for (const pipe of pipes) {
        val = (await pipe.transform(val, {
          type: 'body',
          metatype: Object,
          schema: PilotPayloadSchema,
        })) as typeof invalidInput;
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(BadRequestException);
    const badRequest = caughtError as BadRequestException;
    expect(badRequest.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const response = badRequest.getResponse() as {
      message: string[];
      statusCode: number;
    };
    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.message).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/title/i),
        expect.stringMatching(/count/i),
      ]),
    );
  });

  it('standardSchemaConverter generates JSON Schema for OpenAPI integration', () => {
    const conversion = standardSchemaConverter(PilotPayloadSchema, {
      schemaType: 'input',
    });

    expect(conversion).toBeDefined();
    expect(conversion?.schema).toBeDefined();

    const schemaObj = conversion?.schema as {
      type: string;
      properties: Record<string, { type?: string }>;
      required: string[];
    };

    expect(schemaObj.type).toBe('object');
    expect(schemaObj.properties.title).toBeDefined();
    expect(schemaObj.properties.count).toBeDefined();
  });
});
