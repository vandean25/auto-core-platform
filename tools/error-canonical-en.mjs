/** Canonical English UI copy when backend harvest text is not English. */
export const CANONICAL_EN_MESSAGES = {
  TYRE_DOT_FUTURE_DATE:
    'The DOT date is later than the measurement capture date. Check the DOT marking and capture date.',
  TYRE_DOT_INVALID_FORMAT:
    'The DOT date marking is invalid. Enter the three or four digits at the end of the DOT marking.',
  TYRE_DOT_INVALID_WEEK:
    'The production week in the DOT marking is invalid. Check the week and year on the tire.',
  TYRE_EVALUATION_DATE_INVALID:
    'The tire measurement capture date is invalid or in the future. Check the date and time.',
  TYRE_MEASUREMENT_EVENT_INVALID:
    'Tread readings can only be recorded on check-in, check-out or inspection events.',
  TYRE_MEASUREMENT_MEDIA_INVALID:
    'At least one photo cannot be linked to this tire measurement. Check the selection and upload the photo again if needed.',
  TYRE_MEASUREMENT_NOT_FOUND:
    'The tire measurement was not found. Reload the page and select an existing measurement.',
  TYRE_MEASUREMENT_ORDER_MISMATCH:
    'The workshop order belongs to a different vehicle than this tire set. Check the order and try again.',
  TYRE_MEASUREMENT_PARENT_NOT_FOUND:
    'The associated record for this tire measurement was not found. Reload the page and check the association.',
  TYRE_MEASUREMENT_VEHICLE_REQUIRED:
    'Tread readings require a tire set linked to a vehicle. Link a vehicle to the set first.',
  TYRE_THRESHOLDS_INVALID:
    'The tire evaluation thresholds are invalid. Check the recommended thresholds; they must not be below the defaults or above 20 mm. Legal minimums cannot be changed.',
  TYRE_TREAD_INVALID:
    'The tread depth is invalid. Enter a value between 0 and 20 mm with at most two decimal places at each measurement point.',
  CHECK_IN_DAMAGE_TYPE_INVALID: 'This damage type is not valid for a check-in marker.',
  CHECK_IN_ZONE_INVALID: 'This vehicle zone is not valid for a check-in marker.',
  CHECK_IN_MEDIA_UPLOADER_REQUIRED:
    'Your user account is not linked to an active employee in this workshop. Ask an administrator to link it.',
  GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED:
    'First registration date is required for shortening.',
  GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE:
    'No rule is configured for contracts before 01/01/2022.',
  GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER:
    'Shortening the statutory warranty period requires a consumer purchase.',
  GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW:
    'First registration must be more than one year before handover.',
  CUSTOMER_VAT_ID_INVALID:
    'The VAT ID is invalid. Check the format for Austria or Germany.',
  IMPORT_AMBIGUOUS_VENDOR:
    'The supplier could not be matched unambiguously. Select the correct supplier.',
  IMPORT_APPLY_FAILED:
    'This row could not be imported. Try importing it again.',
  IMPORT_APPLY_IN_PROGRESS:
    'The import is already running. Wait for it to finish.',
  IMPORT_APPLY_INTERRUPTED:
    'The import was interrupted. Restart it to continue.',
  IMPORT_ARTICLE_NOT_FOUND:
    'The item was not found. Check the item number or allow new items to be created.',
  IMPORT_CONSENT_COLUMN_IGNORED:
    'Consent and marketing columns are not imported.',
  IMPORT_DESCRIPTION_REQUIRED:
    'The description is missing. Enter a description for this row.',
  IMPORT_DIRECT_UPLOAD_CONTENT_TYPE:
    'This file type is not supported. Upload a CSV file.',
  IMPORT_DIRECT_UPLOAD_INVALID:
    'The file could not be prepared for import. Upload it again.',
  IMPORT_DIRECT_UPLOAD_NOT_FOUND:
    'The uploaded file is no longer available. Upload it again.',
  IMPORT_DIRECT_UPLOAD_TOO_LARGE:
    'The file is too large. Split it into smaller files.',
  IMPORT_DRY_RUN_IN_PROGRESS:
    'The dry-run is already running. Wait for the result.',
  IMPORT_DUPLICATE_ARTICLE_NO_IN_FILE:
    'The item number appears more than once in the file. Use each item number only once.',
  IMPORT_DUPLICATE_CODE_IN_FILE:
    'The labor code appears more than once in the file. Use each labor code only once.',
  IMPORT_DUPLICATE_EMAIL_IN_FILE:
    'The email address appears more than once in the file. Check the affected customer rows.',
  IMPORT_DUPLICATE_EXTERNAL_ID_IN_FILE:
    'The external ID appears more than once in the file. Use each external ID only once.',
  IMPORT_DUPLICATE_VIN_IN_FILE:
    'The VIN appears more than once in the file. Check the affected vehicle rows.',
  IMPORT_EMPTY_FILE:
    'The file contains no data rows. Check the file.',
  IMPORT_EVIDENCE_IMMUTABLE:
    'The completed record cannot be changed. Check the existing vehicle data.',
  IMPORT_EXISTING_NOT_UPDATED:
    'The record was not updated. Enable “Update existing” if you want to change it.',
  IMPORT_EXTERNAL_ID_REQUIRED:
    'The external ID is missing. Enter an ID for this row.',
  IMPORT_FILE_TOO_LARGE:
    'The file is too large. Split it into smaller files.',
  IMPORT_GROUP_TOO_LARGE:
    'The import group contains too many rows. Split the file.',
  IMPORT_IDENTITY_CHANGED:
    'This row would change the assignment of an existing record. Check the assignment or use a new external ID.',
  IMPORT_INVALID_COST_PRICE:
    'The purchase price is invalid. Enter an amount greater than zero.',
  IMPORT_INVALID_ENCODING:
    'The file could not be read as text. Save it as a UTF-8 CSV and upload it again.',
  IMPORT_INVALID_ENTITY_TYPE:
    'This data type is not supported. Select an available import type.',
  IMPORT_INVALID_HOURLY_RATE:
    'The hourly rate is invalid. Enter an amount of zero or more.',
  IMPORT_INVALID_INTERNAL_COST:
    'The internal cost rate is invalid. Enter an amount of zero or more.',
  IMPORT_INVALID_MAPPING:
    'The column mapping is invalid. Map all required fields.',
  IMPORT_INVALID_STANDARD_AW:
    'The labor value is invalid. Enter a number of zero or more.',
  IMPORT_JOB_ALREADY_APPLIED:
    'This import has already been applied. Upload a new file to start another import.',
  IMPORT_JOB_EXPIRED:
    'The dry-run has expired. Upload the file again and run the dry-run again.',
  IMPORT_JOB_NOT_FOUND:
    'The import was not found. Open an existing import or upload the file again.',
  IMPORT_JOB_PURGED:
    'The prepared import data was deleted. Upload the file again and run the dry-run again.',
  IMPORT_JOB_STALE:
    'The dry-run is no longer current. Run it again.',
  IMPORT_LABOR_CODE_CONFLICT:
    'The external ID and labor code refer to different labor operations. Check both values.',
  IMPORT_LABOR_CODE_REQUIRED:
    'The labor code is missing. Enter a code for this row.',
  IMPORT_LABOR_DESCRIPTION_REQUIRED:
    'The labor operation description is missing. Enter a description for this row.',
  IMPORT_LABOR_FITMENT_MAKE_MODEL_REQUIRED:
    'The fitment make or model is missing. Enter both values.',
  IMPORT_MAKE_REQUIRED:
    'The vehicle make is missing. Enter the make for this row.',
  IMPORT_MAPPING_PROFILE_EXISTS:
    'A mapping profile with this name already exists. Choose another name.',
  IMPORT_MATCHED_BY_PLATE:
    'The vehicle was matched by license plate because the VIN is missing. Check the match.',
  IMPORT_MODEL_REQUIRED:
    'The vehicle model is missing. Enter the model for this row.',
  IMPORT_NATURAL_KEY_CONFLICT:
    'A record with the same details already exists. Check duplicate rows and existing vehicle data.',
  IMPORT_OWNER_CONTACT_CONFLICT:
    'The owner assignment conflicts with the vehicle main contact. Check the owner and validity period.',
  IMPORT_POSSIBLE_DUPLICATE:
    'A record with this name may already exist. Check for duplicates.',
  IMPORT_PRICE_JUMP_REQUIRES_ACCEPTANCE:
    'The price change needs approval. Check the affected rows and approve the new prices.',
  IMPORT_ROW_LIMIT_EXCEEDED:
    'The file contains too many rows. Split it into smaller files.',
  IMPORT_ROW_STALE:
    'The data for this row has changed. Run the dry-run again.',
  IMPORT_STORAGE_UNAVAILABLE:
    'The import file could not be saved. Try again.',
  IMPORT_SUPPLIER_ARTICLE_NO_REQUIRED:
    'The supplier item number is missing. Enter it for this row.',
  IMPORT_SUPPLIER_VENDOR_REQUIRED:
    'This price list has no supplier. Select a supplier.',
  IMPORT_UNKNOWN_CUSTOMER:
    'The customer was not found. Check the external customer ID or import the customer first.',
  IMPORT_UNKNOWN_OWNER:
    'The vehicle owner was not found. Check the external customer ID or import the customer first.',
  IMPORT_UNKNOWN_VEHICLE:
    'The vehicle was not found. Check the external vehicle ID or import the vehicle first.',
  IMPORT_UPDATE_NOT_ENABLED:
    'The existing record was not changed. Enable “Update existing” to apply the changes.',
  IMPORT_VALUE_INVALID:
    'A value is invalid. Check the values and their format in this row.',
  IMPORT_VALUE_REQUIRED:
    'A required value is missing. Fill in the missing value for this row.',
  IMPORT_VIN_CHECK_DIGIT:
    'The VIN check digit is invalid. Check the VIN; import is possible with a warning.',
  IMPORT_VIN_INVALID:
    'The VIN must contain 17 characters and no I, O, or Q. Check the VIN.',
  IMPORT_VIN_REQUIRED:
    'The VIN is missing. Enter it or enable “Allow missing VIN”.',
  IMPORT_YEAR_INVALID:
    'The model year is invalid. Enter a year between 1900 and 2100.',
  LABOR_CATEGORY_UNKNOWN:
    'The labor category was not found. Check the category; the row is imported without it.',
  PRICE_JUMP_EXCEEDED:
    'The price change exceeds the allowed threshold. Check the new price.',
  RRP_MISSING_FOR_MARGIN_RULE:
    'The recommended retail price is missing for the price calculation. Enter it or set a markup.',
  LISTING_SERIALIZER_UNSUPPORTED:
    'No listing export format is available for this portal.',
}
