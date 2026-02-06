import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';
import { WorkshopOrderStatus } from '@prisma/client';

@Injectable()
export class WorkshopService {
  constructor(private prisma: PrismaService) {}

  async register(dto: RegisterIntakeDto) {
    let customerId = dto.customerId;

    if (!customerId) {
      const customer = await this.prisma.customer.create({
        data: {
          first_name: dto.firstName,
          last_name: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          type: 'PRIVATE',
        },
      });
      customerId = customer.id;
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        vin: dto.vin,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        customer_id: customerId,
      },
      include: {
        customer: true,
      }
    });

    return vehicle;
  }

  async create(dto: CreateWorkshopOrderDto) {
    return this.prisma.workshopOrder.create({
      data: {
        customer_id: dto.customerId,
        vehicle_id: dto.vehicleId,
        odometer: dto.odometer,
        fuel_level: dto.fuelLevel,
        notes: dto.notes,
        status: WorkshopOrderStatus.INTAKE,
      },
    });
  }

  async search(query: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        OR: [
          { vin: { contains: query, mode: 'insensitive' } },
          { plate: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        customer: true,
      },
    });

    const customers = await this.prisma.customer.findMany({
      where: {
        OR: [
          { id: { equals: query } },
          // Also search by name/company as it's useful
          { last_name: { contains: query, mode: 'insensitive' } },
          { company_name: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        vehicles: true,
      },
    });

    return { vehicles, customers };
  }
}
