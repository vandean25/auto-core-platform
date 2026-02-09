# Specification: Prepare Core API for Cloud Run Deployment

## Overview
This feature aims to prepare the `apps/core-api` (NestJS) application for production deployment on Google Cloud Run. Key focus areas include securing the application via strict CORS and global authentication, containerizing the application using an optimized multi-stage Dockerfile, and ensuring proper configuration for the Cloud Run environment.

## Functional Requirements
- **Strict CORS Configuration**:
    - The application must strictly allow requests only from the trusted Frontend URL.
    - This URL must be configurable via an environment variable `FRONTEND_URL`.
    - Default behavior should block cross-origin requests if the origin does not match `FRONTEND_URL`.
    - For this deployment, `FRONTEND_URL` will be set to `https://auto-core-platform-vande.web.app`.
- **Global Authentication Guard**:
    - Implement a global authentication guard to secure all endpoints by default.
    - Provide a `@Public()` decorator to explicitly exempt public endpoints (e.g., health checks, login/auth routes).
- **Configuration**:
    - The application must listen on the port defined by the `PORT` environment variable (required by Cloud Run).
    - Database connection must be established using the `DATABASE_URL` environment variable.

## Non-Functional Requirements
- **Containerization**:
    - Create a production-optimized `Dockerfile` for `apps/core-api`.
    - **Base Image**: Use `node:20-alpine` (or similar lightweight variant) to minimize image size.
    - **Security**: The container process must run as a non-root user.
    - **Build Process**: Include `npx prisma generate` in the build stage to ensure the Prisma Query Engine is compatible with the Alpine Linux architecture.
- **Security**:
    - Adhere to the principle of least privilege for network access (CORS) and endpoint access (Auth Guard).

## Acceptance Criteria
- [ ] **CORS**: Requests from `https://auto-core-platform-vande.web.app` are accepted, while requests from other origins are rejected (when configured).
- [ ] **Auth**: Accessing a protected route without a token returns 401 Unauthorized.
- [ ] **Auth**: Accessing a route marked with `@Public()` works without a token.
- [ ] **Docker**: The Docker image builds successfully and is significantly smaller than a standard development image.
- [ ] **Runtime**: The container starts up successfully, connects to the database using `DATABASE_URL`, and listens on `process.env.PORT`.
- [ ] **Prisma**: Database queries work correctly inside the container (verifying correct Prisma engine binary).

## Out of Scope
- Setting up the Google Cloud Run service itself (this task focuses on application readiness).
- CI/CD pipeline configuration (GitHub Actions, Cloud Build).
