# Hi Te! Vercel deployment

This project contains a static HTML frontend and a Flask API. `vercel.json` serves the frontend from `System(front-end)` and routes `/api/*` and `/uploads/*` to the Python function in `api/index.py`. Browser API calls are same-origin in deployment; local development can override `window.API_BASE_URL` in `System(front-end)/js/config.js`.

## Required Vercel environment variables

Set these for **Production**, **Preview**, and any environment where the API runs:

- `DATABASE_URL`: managed MySQL-compatible connection string (or all five `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` variables).
- `JWT_SECRET_KEY`: random value with at least 32 characters. Never use the example value.
- `CORS_ORIGINS`: comma-separated allowed browser origins, including the deployed frontend URL when it differs from the API origin.

Do not deploy the local `.env`; it is ignored by git. Copy `.env.example` only as a configuration reference.

## One-time first-admin bootstrap

Public registration always creates customer accounts. To create the first admin, temporarily add the exact Vercel variables `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` in the **Production** environment, with optional `BOOTSTRAP_ADMIN_FULL_NAME` and `BOOTSTRAP_ADMIN_EMAIL`, then redeploy once. Vercel variable names are case-sensitive, and variables added only to Preview do not reach a Production deployment. During `api/index.py` startup after `db.create_all()`, the app logs only a status (`created`, `disabled`, or `existing:<role>`) and whether the two required variables are present; it never logs credentials, hashes, usernames, or email addresses. The app creates an admin only when no matching username exists and bcrypt-hashes the password. Verify the admin login using the exact bootstrap username and password, remove `BOOTSTRAP_ADMIN_PASSWORD` and the other bootstrap variables, and redeploy. Existing accounts are not changed by later startups. If logs show `existing:customer`, choose a new bootstrap username or promote the account through an existing admin; the bootstrap intentionally never changes an existing account.

After signing in, the existing admin users endpoint/dashboard can create seller and driver accounts (as well as customer or admin accounts). Do not use public registration to create privileged roles.

## One-time existing-admin password reset

If an existing admin row is present but its password is unknown, temporarily add the exact case-sensitive Vercel Production variables `BOOTSTRAP_ADMIN_RESET_USERNAME`, `BOOTSTRAP_ADMIN_RESET_PASSWORD`, and `BOOTSTRAP_ADMIN_RESET_CONFIRM=true`, then redeploy. The reset runs only when the confirmation value is exactly `true`; it fails if the username is missing, does not exist, or belongs to a non-admin. It replaces only the existing admin's bcrypt password hash and logs no values or passwords. Verify admin login with the reset password, remove all `BOOTSTRAP_ADMIN_RESET_*` variables (and any temporary `BOOTSTRAP_ADMIN_*` variables), then redeploy. Reset is disabled for every other confirmation value.

## Limitations and setup

Vercel functions are stateless and have ephemeral filesystems. New product images uploaded on Vercel are therefore validated and stored as database-backed data URLs (PNG/JPG/JPEG/GIF/WEBP, maximum 300 KB), so seller, customer, and admin responses can render them without an external provider. Startup adds the non-destructive `products.image_data` column when an older database is missing it. Existing `image_path` values continue to resolve through `/uploads/<filename>` where the file exists; those legacy files should be migrated to durable storage if they are needed on Vercel. Local development continues to use filesystem uploads. The current SSE implementation is process-local and is not durable or shared across serverless instances; dashboards retain their existing polling refresh and SSE should be treated as best-effort notifications.

The database must be external because a local SQLite file is not durable on Vercel. On startup, the app runs SQLAlchemy's non-destructive `db.create_all()` after connecting; this creates missing tables for a first deployment and never drops or alters existing tables. Use a proper migration tool/process for future schema changes. The database user must have permission to create tables during the initial deployment. In Vercel, deploy from the project root and keep the default build settings so `vercel.json` controls the Python function and static assets.
