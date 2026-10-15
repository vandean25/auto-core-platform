import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  RegistrationFieldEvidence,
  RegistrationMatchSnapshot,
} from './registration-document-extraction.types.js';

@Injectable()
export class RegistrationIntakeMatchService {
  async buildMatchSnapshot(
    prisma: PrismaService,
    tenantId: string,
    fields: Record<string, RegistrationFieldEvidence>,
    extraCases: string[],
  ): Promise<RegistrationMatchSnapshot> {
    const cases = [...extraCases];
    const holder = fields.holder?.normalized;
    const holderFirst =
      holder && typeof holder === 'object' && 'firstName' in holder
        ? holder.firstName.trim()
        : null;
    const holderLast =
      holder && typeof holder === 'object' && 'lastName' in holder
        ? holder.lastName.trim()
        : null;

    let customers: RegistrationMatchSnapshot['customers'] = [];
    if (holderFirst && holderLast) {
      const rows = await prisma.customer.findMany({
        where: {
          tenant_id: tenantId,
          first_name: { equals: holderFirst, mode: 'insensitive' },
          last_name: { equals: holderLast, mode: 'insensitive' },
        },
        take: 25,
        select: { id: true, first_name: true, last_name: true },
      });
      customers = rows.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
      }));
      if (rows.length === 1) {
        cases.push('EXISTING_CUSTOMER');
      } else if (rows.length > 1) {
        cases.push('DUPLICATE_CUSTOMERS');
      }
    }

    const vin =
      typeof fields.vin?.normalized === 'string' ? fields.vin.normalized : null;
    const plate =
      typeof fields.plate?.normalized === 'string' ? fields.plate.normalized : null;

    let vehicles: RegistrationMatchSnapshot['vehicles'] = [];
    if (vin) {
      const rows = await prisma.vehicle.findMany({
        where: { tenant_id: tenantId, vin },
        take: 25,
        select: {
          id: true,
          vin: true,
          plate: true,
          customer_id: true,
        },
      });
      vehicles = rows.map((row) => ({
        id: row.id,
        vin: row.vin,
        plate: row.plate,
        customerId: row.customer_id,
      }));
    } else if (plate) {
      const rows = await prisma.vehicle.findMany({
        where: {
          tenant_id: tenantId,
          plate: { equals: plate, mode: 'insensitive' },
        },
        take: 25,
        select: {
          id: true,
          vin: true,
          plate: true,
          customer_id: true,
        },
      });
      vehicles = rows.map((row) => ({
        id: row.id,
        vin: row.vin,
        plate: row.plate,
        customerId: row.customer_id,
      }));
    }

    if (vehicles.length === 1) {
      cases.push('EXISTING_VEHICLE');
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicles[0].id, tenant_id: tenantId },
        select: {
          national_code: true,
          first_registration_date: true,
          co2_wltp_g_km: true,
          co2_nedc_g_km: true,
          customer_id: true,
        },
      });
      if (vehicle) {
        const code =
          typeof fields.nationalcode?.normalized === 'string'
            ? fields.nationalcode.normalized
            : null;
        if (
          code &&
          vehicle.national_code &&
          vehicle.national_code !== code
        ) {
          cases.push('NATIONALCODE_CONFLICT');
        }
        const firstReg =
          typeof fields.firstRegistration?.normalized === 'string'
            ? fields.firstRegistration.normalized
            : null;
        if (
          firstReg &&
          vehicle.first_registration_date &&
          vehicle.first_registration_date.toISOString().slice(0, 10) !== firstReg
        ) {
          cases.push('FIRST_REGISTRATION_CONFLICT');
        }
        const co2 = fields.co2;
        if (co2?.cycle === 'WLTP' && typeof co2.normalized === 'number') {
          if (
            vehicle.co2_wltp_g_km !== null &&
            vehicle.co2_wltp_g_km !== co2.normalized
          ) {
            cases.push('CO2_CONFLICT');
          }
        }
        if (co2?.cycle === 'NEDC' && typeof co2.normalized === 'number') {
          if (
            vehicle.co2_nedc_g_km !== null &&
            vehicle.co2_nedc_g_km !== co2.normalized
          ) {
            cases.push('CO2_CONFLICT');
          }
        }
        if (
          customers.length === 1 &&
          vehicle.customer_id &&
          vehicle.customer_id !== customers[0].id
        ) {
          cases.push('OWNERSHIP_CONFLICT');
        }
      }
    } else if (vehicles.length > 1) {
      cases.push('DUPLICATE_VEHICLES');
    }

    return {
      customers,
      vehicles,
      cases: [...new Set(cases)],
    };
  }
}
