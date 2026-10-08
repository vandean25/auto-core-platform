import { PartialType } from '@nestjs/swagger';
import { CreateMarginRuleDto } from './create-margin-rule.dto.js';

export class UpdateMarginRuleDto extends PartialType(CreateMarginRuleDto) {}
