import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PREFIX = 'workflow-catalog-';

describe('Catalog Workflow Search (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        process.env.API_KEY = 'test-api-key';
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    it('should complete full business workflow and correctly filter labor by fitment', async () => {
        const ts = Date.now();
        const apiKey = 'test-api-key';

        // Cleanup any leftovers from aborted runs using a safe manual query or findFirst then delete
        // For simplicity in this test, we skip complex cleanup and just use unique prefixes

        // 1. Setup Master Data (Brands)
        const skodaBrand = await prisma.brand.upsert({
            where: { name: 'Skoda' },
            create: { name: 'Skoda', isVehicleMake: true, isPartManufacturer: false },
            update: {}
        });

        const bmwBrand = await prisma.brand.upsert({
            where: { name: 'BMW' },
            create: { name: 'BMW', isVehicleMake: true, isPartManufacturer: true },
            update: {}
        });

        // 2. Setup Test Labor Operations
        const universalCode = `${PREFIX}UNIVERSAL-${ts}`;
        const matchingCode = `${PREFIX}MATCHING-${ts}`;
        const nonMatchingCode = `${PREFIX}NON-MATCHING-${ts}`;

        // Case A: Universal (No fitments)
        const opUniversal = await prisma.laborOperation.create({
            data: {
                code: universalCode,
                description: `SearchKey Universal ${ts}`,
                standard_aw: 1.0,
                hourly_rate: 100,
            }
        });

        // Case B: Matching (Skoda Octavia)
        const opMatching = await prisma.laborOperation.create({
            data: {
                code: matchingCode,
                description: `SearchKey Matching ${ts}`,
                standard_aw: 1.5,
                hourly_rate: 100,
                fitments: {
                    create: {
                        make: 'Skoda',
                        model: 'Octavia',
                        year_from: 2015,
                    }
                }
            }
        });

        // Case C: Non-Matching (BMW)
        const opNonMatching = await prisma.laborOperation.create({
            data: {
                code: nonMatchingCode,
                description: `SearchKey Hidden ${ts}`,
                standard_aw: 2.0,
                hourly_rate: 100,
                fitments: {
                    create: {
                        make: 'BMW',
                        model: 'M3',
                    }
                }
            }
        });

        // 3. Register Customer & Vehicle (Skoda Octavia)
        const registerResponse = await request(app.getHttpServer())
            .post('/api/workshop/register')
            .set('x-api-key', apiKey)
            .send({
                firstName: 'Workflow',
                lastName: 'Tester',
                email: `${PREFIX}${ts}@test.com`,
                phone: '+43 664 0000000',
                make: 'Skoda',
                model: 'Octavia',
                year: 2020,
                vin: `${PREFIX}VIN-${ts}`,
                plate: `${PREFIX}PLATE-${ts}`,
            })
            .expect(201);

        const customerId = registerResponse.body.customer_id;
        const vehicleId = registerResponse.body.id;

        // 4. Create Workshop Order
        const orderResponse = await request(app.getHttpServer())
            .post('/api/workshop/orders')
            .set('x-api-key', apiKey)
            .send({
                customerId: customerId,
                vehicleId: vehicleId,
                odometer: 1000,
                fuelLevel: 100,
            })
            .expect(201);

        const workshopOrderId = orderResponse.body.id;

        // 5. Final Step: Search and Verify Fitment Filtering
        const searchResponse = await request(app.getHttpServer())
            .get(`/api/catalog/search?q=SearchKey&workshopOrderId=${workshopOrderId}`)
            .set('x-api-key', apiKey)
            .expect(200);

        const labor = searchResponse.body.labor;
        const foundCodes = labor.map((l: any) => l.code);

        // Assertions
        expect(foundCodes).toContain(universalCode);     // Correctly found Universal
        expect(foundCodes).toContain(matchingCode);      // Correctly found Specific Matching
        expect(foundCodes).not.toContain(nonMatchingCode); // Correctly HIDDEN Non-matching
    });
});
