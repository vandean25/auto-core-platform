# Product Definition: Auto Core Platform

Auto Core Platform is a full-stack automotive parts management system designed for inventory tracking, purchase order processing, vendor management, sales invoicing, and financial reporting.

## Core Modules
- **Inventory**: Tracks automotive parts, storage locations, and stock levels with a full audit trail (ledger-based).
- **Purchase (Procurement)**: Manages purchase orders (POs) from draft to completion, including goods receipt and vendor billing.
- **Sales (CRM & Invoicing)**:
    - **CRM**: Customer management (Private/Company) with full order and vehicle history.
    - **Sales Orders**: Workflow from Draft -> Confirmed -> Completed -> Invoice.
    - **Invoicing**: Generates final tax invoices from completed sales orders with real-time stock integration.
- **Finance**: Manages global fiscal settings (lock dates, numbering) and revenue categorization for accounting exports.
- **Brand (Master Data)**: Centralized management of vehicle makes and part manufacturers, enabling consistent categorization and smart filtering.
- **Vendor**: Management of external stakeholders and their associated data (brands, contact info).
