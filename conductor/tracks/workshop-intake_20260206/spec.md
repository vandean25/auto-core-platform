# Specification: Workshop Intake Module

## Overview
The Workshop Intake Module provides a dedicated entry point for service staff to quickly identify customers and vehicles as they arrive at the workshop. It streamlines the creation of service-related records by providing a high-speed search and registration interface.

## Functional Requirements
- **Intake Dashboard**: A specialized dashboard designed for rapid data entry and search.
- **Multi-Criteria Search**:
    - Search by **VIN** (Primary).
    - Search by **License Plate / Registration Number**.
    - Search by **Customer Number**.
- **CRM Integration**:
    - Lookup existing customers and vehicles from the CRM.
    - View recent history for recognized vehicles/customers.
- **In-Context Registration**:
    - If a search yields no results, provide an inline creation form (Modal or Sidepanel) to register the new vehicle and customer without leaving the dashboard.
- **Service Initiation**: One-click action to create a **WorkshopOrder**.
    - **Mandatory Fields**: Must capture current **Odometer Reading (km)** and **Fuel Level (0-100%)** before creation.
    - **Intake Notes**: Specific text area for "**Customer Description of Issue**".

## Technical Constraints
- **UI Components**: Use existing `shadcn/ui` patterns (Dialog/Sheet for the registration form).
- **State Management**: Use TanStack Query for efficient search and data fetching.
- **Backend**:
    - Extend `core-api` with specific intake-related endpoints.
    - **Schema**: Create a new `WorkshopOrder` entity (distinct from `SalesOrder`) with status enum: `SCHEDULED`, `INTAKE`, `IN_PROGRESS`, `COMPLETED`.

## Acceptance Criteria
- [ ] Users can search for a vehicle by **VIN**, **License Plate**, or **Customer Number** on the Intake Dashboard.
- [ ] If the record exists, its details and the associated customer/vehicle are displayed.
- [ ] If the vehicle does not exist, a "New Vehicle" form is presented immediately.
- [ ] Successfully submitting the registration form creates both the Vehicle and (if new) Customer records.
- [ ] A "**Start Service**" button creates a `WorkshopOrder` record with status `INTAKE` and links it to the Vehicle/Customer, requiring Odometer and Fuel level inputs.

## Out of Scope
- Detailed damage assessment and photo uploads.
- Real-time parts availability or inventory integration for estimations.
- External VIN decoding API integration (manual entry for now).