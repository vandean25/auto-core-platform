import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function inspectorEvidenceForbidden() {
  return new ForbiddenException('Insufficient role for inspector evidence');
}

export function inspectorEvidenceNotFound(id: string) {
  return new NotFoundException(`Inspector evidence revision ${id} not found`);
}

export function employeeNotFound(id: string) {
  return new NotFoundException(`Employee with ID ${id} not found`);
}

export function unsupportedSchemaVersion() {
  return new UnprocessableEntityException({
    code: 'UNSUPPORTED_SCHEMA_VERSION',
  });
}

export function invalidDocumentReference() {
  return new UnprocessableEntityException({
    code: 'INVALID_DOCUMENT_REFERENCE',
  });
}

export function reviewRequired() {
  return new ConflictException({ code: 'REVIEW_REQUIRED' });
}

export function invalidAssessmentTimestamp() {
  return new BadRequestException({ code: 'INVALID_ASSESSMENT_TIMESTAMP' });
}
