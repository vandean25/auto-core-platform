import type { SeedPrismaClient } from './types';

export const SAMPLE_CUSTOMERS_DATA = [
  {
    first_name: 'Max',
    last_name: 'Mustermann',
    email: 'max@example.at',
    phone: '+43 664 1234567',
    address_street: 'Stephansplatz 1',
    address_city: 'Vienna',
    address_zip: '1010',
    vehicles: [
      {
        make: 'Volkswagen',
        model: 'Golf VII',
        year: 2018,
        plate: 'W-12345AB',
        vin: 'VWZZZ12345678901',
      },
    ],
  },
  {
    first_name: 'Susi',
    last_name: 'Sorglos',
    email: 'susi@sorglos.at',
    phone: '+43 676 9876543',
    address_street: 'Mariahilfer Straße 50',
    address_city: 'Vienna',
    address_zip: '1070',
    vehicles: [
      {
        make: 'Audi',
        model: 'A4 B9',
        year: 2020,
        plate: 'W-98765XY',
        vin: 'WAUZZZ9876543210',
      },
      {
        make: 'Porsche',
        model: '911 Carrera',
        year: 2022,
        plate: 'W-911PS',
        vin: 'WP0ZZZ1112223334',
      },
    ],
  },
  {
    first_name: 'Thomas',
    last_name: 'Turboschrauber',
    email: 'thomas@tuning.at',
    phone: '+43 650 5554433',
    address_street: 'Grazer Gasse 12',
    address_city: 'Graz',
    address_zip: '8010',
    vehicles: [
      {
        make: 'BMW',
        model: 'M3 G80',
        year: 2023,
        plate: 'G-TUNER1',
        vin: 'WBS3334445556667',
      },
    ],
  },
  {
    first_name: 'Anna',
    last_name: 'Alpin',
    email: 'anna@berge.at',
    phone: '+43 699 1122334',
    address_street: 'Tiroler Weg 7',
    address_city: 'Innsbruck',
    address_zip: '6020',
    vehicles: [
      {
        make: 'Toyota',
        model: 'Land Cruiser',
        year: 2015,
        plate: 'IL-4WD1',
        vin: 'JTMLC123456789012',
      },
    ],
  },
  {
    first_name: 'Klaus',
    last_name: 'Kombi',
    email: 'klaus@logistik.at',
    phone: '+43 680 8877665',
    address_street: 'Salzburger Ring 3',
    address_city: 'Salzburg',
    address_zip: '5020',
    vehicles: [
      {
        make: 'Skoda',
        model: 'Octavia IV RS',
        year: 2021,
        plate: 'S-SKODA1',
        vin: 'TMBZZZSK12345678',
      },
    ],
  },
];

export async function seedCustomersAndVehicles(
  prisma: SeedPrismaClient,
  tenantId: string,
) {
  console.log('Seeding Customers and Vehicles...');

  const createdCustomers = await Promise.all(
    SAMPLE_CUSTOMERS_DATA.map((customer) =>
      prisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email,
          phone: customer.phone,
          address_street: customer.address_street,
          address_city: customer.address_city,
          address_zip: customer.address_zip,
        },
      }),
    ),
  );

  const vehiclesToCreate = SAMPLE_CUSTOMERS_DATA.flatMap((data, index) =>
    data.vehicles.map((vehicle) => ({
      tenant_id: tenantId,
      ...vehicle,
      customer_id: createdCustomers[index].id,
    })),
  );

  if (vehiclesToCreate.length > 0) {
    await prisma.vehicle.createMany({ data: vehiclesToCreate });
  }

  return {
    customers: createdCustomers,
    vehicleCount: vehiclesToCreate.length,
  };
}
