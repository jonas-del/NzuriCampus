# Nzuri Venue Management

Nzuri Venue Management uses plain HTML, CSS, and JavaScript with an Express application, hosted PostgreSQL, and server-side sessions. The current slice includes the public page, a separate administrator sign-in, a protected dashboard, and one-time first-admin setup. Venue and booking management actions are planned for later phases.

## Deploy with GitHub, Vercel, and Neon

1. Push this project to a GitHub repository and import that repository into Vercel.
2. In the Vercel project, install the Neon integration from the Marketplace. Create a Neon PostgreSQL project in the same region as the Vercel Function. Use the pooled connection string for the serverless app.
3. In Neon Console's SQL Editor, run `database/schema.sql` to create the application and session tables.
4. In Vercel project settings, confirm `DATABASE_URL` contains the pooled Neon connection string. Add `SESSION_SECRET` and `ADMIN_SETUP_KEY`, each generated with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Generate a separate value for each variable. Keep these secrets in Vercel's environment-variable settings, not in source control or chat. Apply them to the Production environment and redeploy.
5. Open `https://<your-vercel-domain>/admin/setup`, enter the `ADMIN_SETUP_KEY`, and create the first administrator. The database allows this setup only once. Afterward, remove `ADMIN_SETUP_KEY` from Vercel's environment variables and redeploy.
6. Sign in from any device at `https://<your-vercel-domain>/admin/login`. The shared Neon database stores the admin account and login sessions, so sessions work across Vercel Function instances.

Vercel serves browser assets from `public/` and runs the exported Express application from `server.js`. Vercel Hobby and Neon Free have provider-specific usage limits and may sleep/scale to zero; this setup is for a student project and is not an unlimited or availability-guaranteed campus service.

## Local development

No PostgreSQL installation is required. Use the same Neon pooled `DATABASE_URL` in a private `.env` file, along with `SESSION_SECRET` and `ADMIN_SETUP_KEY`, then run:

```powershell
npm install
npm run dev
```

The local app is served at `http://127.0.0.1:3000`. Do not commit `.env`; it is ignored by Git.

For a live public service, configure Vercel Firewall rate limiting and monitor both Vercel and Neon usage. The in-process login limiter is an additional per-function-instance guard, not a shared global limit across all serverless instances.
