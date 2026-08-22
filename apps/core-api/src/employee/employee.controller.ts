import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';
import { EmployeeService } from './employee.service';
import {
  CreateEmployeeDto,
  EmployeeDeleteResponseDto,
  EmployeeResponseDto,
  EmployeesListResponseDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

@ApiTags('employees')
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @ApiOkResponse({ type: EmployeesListResponseDto })
  @ApiQuery({
    name: 'role',
    required: false,
    enumName: 'EmployeeRole',
    enum: EmployeeRole,
  })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query() query: ListEmployeesQueryDto) {
    return this.employeeService.findAll(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: EmployeeResponseDto })
  findOne(@Param('id') id: string) {
    return this.employeeService.findOne(id);
  }

  @Post()
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeeService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: EmployeeResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeeService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: EmployeeDeleteResponseDto })
  @ApiConflictResponse({
    description:
      'Employee is referenced by workshop orders, work records, or HR records',
  })
  remove(@Param('id') id: string) {
    return this.employeeService.remove(id);
  }
}
