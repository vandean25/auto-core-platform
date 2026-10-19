/**
 * Keeps generate-openapi.mjs thin while documenting read-only detail fields that
 * live on dedicated response DTO modules re-exported outside legacy barrel files.
 */
export function applyOpenApiDetailFieldPatches(document) {
  const workshopOrder =
    document.components?.schemas?.WorkshopOrderResponseDto?.properties;
  if (workshopOrder && !workshopOrder.bill_to_customer_id) {
    workshopOrder.bill_to_customer_id = {
      type: 'string',
      nullable: true,
    };
  }
}
