import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { WorkshopCommandService } from './workshop-command.service.js';
import {
  InterpretWorkshopCommandDto,
  ProposeWorkshopCommandDto,
  WorkshopCommandClarificationDto,
  WorkshopCommandIntentDto,
  WorkshopCommandProposalResultDto,
} from './dto/workshop-command.dto.js';
import type { InterpretResult } from './workshop-command.types.js';

@ApiTags('Workshop Commands')
@ApiExtraModels(WorkshopCommandIntentDto, WorkshopCommandClarificationDto)
@Controller('workshop/commands')
export class WorkshopCommandController {
  constructor(private readonly commands: WorkshopCommandService) {}

  @Post('interpret')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Interpret an advisor sentence into a reviewed booking preview',
    description:
      'Local resolution only. No provider call and no domain write; one replay row is stored for the command.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(WorkshopCommandIntentDto) },
        { $ref: getSchemaPath(WorkshopCommandClarificationDto) },
      ],
    },
  })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  interpret(
    @Body() body: InterpretWorkshopCommandDto,
  ): Promise<InterpretResult> {
    return this.commands.interpret(body);
  }

  @Post('propose')
  @ApiOperation({
    summary: 'Store the reviewed booking package in the proposal queue',
    description:
      'Recomputes the intent from the stored tokens and accepted selections, then persists one PENDING proposal. A matching retry returns the same ids.',
  })
  @ApiCreatedResponse({ type: WorkshopCommandProposalResultDto })
  @ApiOkResponse({ type: WorkshopCommandProposalResultDto })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async propose(
    @Body() body: ProposeWorkshopCommandDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const outcome = await this.commands.propose(body);
    response.status(outcome.statusCode);
    return outcome.body;
  }
}
