import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreatePartsReservationDto } from './create-parts-reservation.dto';

const collectConstraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...(error.constraints ? Object.values(error.constraints) : []),
    ...collectConstraintMessages(error.children ?? []),
  ]);

describe('CreatePartsReservationDto', () => {
  it('accepts a positive quantity with up to three decimal places', async () => {
    const dto = plainToInstance(CreatePartsReservationDto, {
      workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440000',
      quantity: 1.5,
      locationId: '550e8400-e29b-41d4-a716-446655440001',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects zero and over-precision quantities', async () => {
    for (const quantity of [0, -0.001, 1.2345]) {
      const dto = plainToInstance(CreatePartsReservationDto, {
        workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440000',
        quantity,
        locationId: '550e8400-e29b-41d4-a716-446655440001',
      });

      const messages = collectConstraintMessages(await validate(dto));

      expect(messages.length).toBeGreaterThan(0);
    }
  });

  it('does not define a request site selector', () => {
    expect('siteId' in new CreatePartsReservationDto()).toBe(false);
  });
});
