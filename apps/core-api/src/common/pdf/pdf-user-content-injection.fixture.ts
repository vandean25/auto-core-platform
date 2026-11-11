/** Shared malicious payloads for PDF layout escaping specs (AUT-974). */
export const PDF_SCRIPT_INJECTION_PAYLOAD = '<script>alert("x")</script>';

export const PDF_XML_INJECTION_PAYLOAD =
  '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "text">]>';

export const PDF_USER_CONTENT_INJECTION_PAYLOADS = [
  PDF_SCRIPT_INJECTION_PAYLOAD,
  PDF_XML_INJECTION_PAYLOAD,
] as const;
