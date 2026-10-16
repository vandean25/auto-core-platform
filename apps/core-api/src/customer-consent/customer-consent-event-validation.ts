import { BadRequestException } from '@nestjs/common';
import { isMarketingPurpose } from './customer-consent.purposes.js';
import type { SoftOptInEvidence } from './customer-consent.permissions.js';
import type { RecordCommunicationEventDto } from './dto/customer-consent.dto.js';

function softOptInFactsComplete(
  evidence: SoftOptInEvidence | null | undefined,
): boolean {
  if (!evidence) {
    return false;
  }
  return (
    evidence.obtained_with_sale === true &&
    evidence.own_similar_products === true &&
    evidence.refusal_opportunity_at_collection === true &&
    evidence.no_prior_refusal === true &&
    evidence.own_similar_message_assessment === true
  );
}

export function assertValidCommunicationEventRequest(
  dto: RecordCommunicationEventDto,
): void {
  if (!isMarketingPurpose(dto.purpose)) {
    return;
  }

  if (dto.status === 'GRANTED') {
    if (dto.basis !== 'CONSENT') {
      throw new BadRequestException(
        'Marketing GRANTED events require basis CONSENT.',
      );
    }
    const version = dto.text_version?.trim();
    const snapshot = dto.text_snapshot?.trim();
    if (!version || !snapshot) {
      throw new BadRequestException(
        'Marketing consent requires text_version and text_snapshot.',
      );
    }
    return;
  }

  if (dto.status === 'SOFT_OPT_IN') {
    if (!softOptInFactsComplete(dto.evidence)) {
      throw new BadRequestException(
        'Soft opt-in requires all evidenced TKG facts and per-message assessment.',
      );
    }
    return;
  }

  if (dto.status === 'REVOKED') {
    return;
  }

  throw new BadRequestException(
    'Unsupported marketing consent status for this purpose.',
  );
}

export function marketingGrantProofComplete(slice: {
  status: string;
  basis?: string | null;
  text_version?: string | null;
  text_snapshot?: string | null;
}): boolean {
  if (slice.status !== 'GRANTED') {
    return true;
  }
  return (
    slice.basis === 'CONSENT' &&
    Boolean(slice.text_version?.trim()) &&
    Boolean(slice.text_snapshot?.trim())
  );
}
