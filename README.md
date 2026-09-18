# Hi Te! Vercel deployment

This project contains a static HTML frontend and a Flask API. `vercel.json` serves the frontend from `System(front-end)` and routes `/api/*` and `/uploads/*` to the Python function in `api/index.py`. Browser API calls are same-origin in deployment; local development can override `window.API_BASE_URL` in `System(front-end)/js/config.js`.

## Required Vercel environment variables

Set these for **Production**, **Preview**, and any environment where the API runs:

- `DATABASE_URL`: managed MySQL-compatible connection string (or all five `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` variables).
- `JWT_SECRET_KEY`: random value with at least 32 characters. Never use the example value.
- `CORS_ORIGINS`: comma-separated allowed browser origins, including the deployed frontend URL when it differs from the API origin.

Do not deploy the local `.env`; it is ignored by git. Copy `.env.example` only as a configuration reference.

## One-time first-admin bootstrap

Public registration always creates customer accounts. To create the first admin, temporarily add `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` in Vercel, with optional `BOOTSTRAP_ADMIN_FULL_NAME` and `BOOTSTRAP_ADMIN_EMAIL`, then redeploy once. On startup after `db.create_all()`, the app checks for the configured username and creates an admin only when no matching username exists; the password is bcrypt-hashed and never logged. Verify that the admin can log in, remove `BOOTSTRAP_ADMIN_PASSWORD` (and the other bootstrap variables if no longer needed), and redeploy. Existing admin accounts are not changed by later startups.

After signing in, the existing admin users endpoint/dashboard can create seller and driver accounts (as well as customer or admin accounts). Do not use public registration to create privileged roles.

## Limitations and setup

Vercel functions are stateless and have ephemeral filesystems. Product images written to `/tmp/uploads` can disappear between invocations, so durable uploads require an external object-storage service and a small change to `_save_image` in `System(back-end)/routes/products.py`. The current SSE implementation is process-local and is not durable or shared across serverless instances; dashboards retain their existing polling refresh and SSE should be treated as best-effort notifications.

The database must be external because a local SQLite file is not durable on Vercel. On startup, the app runs SQLAlchemy's non-destructive `db.create_all()` after connecting; this creates missing tables for a first deployment and never drops or alters existing tables. Use a proper migration tool/process for future schema changes. The database user must have permission to create tables during the initial deployment. In Vercel, deploy from the project root and keep the default build settings so `vercel.json` controls the Python function and static assets.
