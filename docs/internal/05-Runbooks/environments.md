# Staging and Production Environments

This runbook is the environment contract for Cloud Build, Cloud Run, Neon,
Firebase, and Google Secret Manager (GSM). The GCP project split is deliberate:
Cloud Run and backend GSM are in `auto-core-platform`; Firebase Auth and
Hosting are in `auto-core-platform-vande`.

At the time of writing, UAT is the only live environment; the tag-triggered
pipeline is therefore a release/UAT pipeline and is not called production.

## Environment matrix

| Environment | Git ref | Cloud Build trigger | Cloud Run service | Neon branch / database | Firebase Hosting site | Database GSM secret |
|---|---|---|---|---|---|---|
| Staging/UAT | `main` | Not enabled until the production cutover; then create a push trigger for `cloudbuild.staging.yaml` | `core-api-staging` | UAT branch / UAT database; the actual Neon names remain in the GSM URL | Hosting preview channel on `auto-core-platform-vande` until a dedicated site is provisioned | `DATABASE_URL_UAT`; current pooled secret is `acp-core-api-database-url-pooled` |
| Production | `^v.*$` | Existing tag trigger is currently UAT/live; switch it to production only after the operator steps below | `core-api` | Production branch / production database; operator must provision these separately from UAT | `auto-core-platform-vande` | `DATABASE_URL_PROD`; pooled URL `acp-core-api-database-url-pooled-prod` |

Neon branch and database names are intentionally not hard-coded in this
repository: their connection URLs are secret values. The names in the table
describe the required separation, not resources created by this change.

Firebase Hosting remains a single known site for now. A staging preview
channel is not a separate Firebase project and does not change the cross-project
Hosting-to-Cloud-Run rewrite limitation documented in the root README.

The staging template intentionally disables Cloud Tasks and Redis realtime and
scales from zero to two instances. It is a low-cost deployment/schema
validation target, not the environment for realtime acceptance testing.

## Deployment ownership

`cloudbuild.yaml` remains the canonical release deployment source for the
current `core-api` service. It builds and deploys images, the PDF worker, and
the frontend, and currently applies the UAT/live settings from its
substitutions. Its `_DATABASE_SECRET: DATABASE_URL_UAT` declaration is
intentional and explicit; it must not be described as a production database.

`infra/` is the checked-in Terraform recovery/reference definition for the
Cloud Run `core-api` service. It captures the service settings currently
passed by `gcloud run deploy`: 1 CPU, 512 MiB, concurrency 40, one minimum
instance, five maximum instances, continuous CPU, public invocation, runtime
environment variables, and GSM secret references. Use the environment
tfvars examples to diff or recreate a service without console clickops:

```bash
terraform -chdir=infra init -backend=false
terraform -chdir=infra plan \
  -var-file=environments/staging.tfvars.example
```

The Terraform resource does not own the container image lifecycle. If an
operator applies it, the image must be supplied explicitly and Cloud Build
continues to own subsequent image releases. Before making Terraform the
authoritative service-config writer, import the live service and remove
duplicated service-setting flags from the deployment pipeline in a separate
change.

Terraform state backend configuration is intentionally not committed. Before
using Terraform for ongoing applies, an operator must choose a locked-down GCS
state bucket in `auto-core-platform`, configure state locking/retention, and
review IAM for the deployment identity.

## Operator steps for a production split

1. Create `DATABASE_URL_PROD` in GSM in `auto-core-platform`, containing the
   production Neon direct connection URL. Do not copy the UAT value.
2. Create `acp-core-api-database-url-pooled-prod` with the production pooled
   Neon URL. Keep the direct URL for migrations and the pooled URL for runtime
   connections.
3. Grant the Cloud Run runtime service account
   `roles/secretmanager.secretAccessor` on both production database secrets and
   on the other runtime secrets referenced by `infra/main.tf`.
4. Confirm the production Neon branch/database, run the migration baseline
   procedure if required, and verify the pooled host and SQL settings.
5. Update the tag trigger substitution from `DATABASE_URL_UAT` to
   `DATABASE_URL_PROD` only after steps 1 through 4. Keep the UAT substitution
   for the staging/UAT trigger.
6. Only after step 5, create a staging Cloud Build trigger for pushes to
   `main`, using `cloudbuild.staging.yaml`, `core-api-staging`, and the UAT
   secret names. Creating this trigger earlier would migrate the live UAT
   database from `main` before the tagged service is updated.
7. If a separate staging Hosting site is later created, update the matrix,
   `firebase.json`, and the relevant Cloud Build substitutions together.

Never commit secret values, generated `.env` files, or Terraform state.
