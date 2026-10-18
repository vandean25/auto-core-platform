export type NormalizedVehicleRow = {
  external_id: string;
  vin: string | null;
  plate: string | null;
  make: string;
  model: string;
  year: number;
  mileage: number | null;
  color: string | null;
  owner_customer_external_id: string | null;
  owner_external_id_provided: boolean;
  key_number: string | null;
  first_registration_date: string | null;
};
