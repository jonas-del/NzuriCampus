# Nzuri Venue Management

Nzuri Venue Management uses plain HTML, CSS, and JavaScript with an Express application, PostgreSQL, and server-side sessions. It includes a public venue and booking-request flow, a separate administrator sign-in, protected venue management, and a dashboard for reviewing requests and approving or rejecting them.

Public and admin availability counts are calculated from active venues and approved booking times. Current occupancy updates automatically as approved booking windows start and end, and the dashboards refresh these live counts every minute. Saturdays and Sundays in the `Africa/Nairobi` timezone are treated as class-free, so all active venues are shown as available on weekends.

## Deploy with GitHub, Vercel, and Neon

1. Push this project to a GitHub repository and import that repository into Vercel.
2. In the Vercel project, install the Neon integration from the Marketplace. Create a Neon PostgreSQL project in the same region as the Vercel Function. Use the pooled connection string for the serverless app.
3. In Neon Console's SQL Editor, run `database/schema.sql` to create the application and session tables.
4. In Vercel project settings, set `NZURI_DATABASE_URL` to the pooled Neon connection string for the database that contains the application schema. The app-specific setting takes precedence over any integration-provided `DATABASE_URL`. Add `SESSION_SECRET` and `ADMIN_SETUP_KEY`, each generated with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Generate a separate value for each variable. Keep these secrets in Vercel's environment-variable settings, not in source control or chat. Apply them to the Production environment and redeploy.
5. Open `https://<your-vercel-domain>/admin/setup`, enter the `ADMIN_SETUP_KEY`, and create the first administrator with a name, email, and password. The database allows this setup only once. Afterward, remove `ADMIN_SETUP_KEY` from Vercel's environment variables and redeploy.
6. Sign in from any device at `https://<your-vercel-domain>/admin/login`. The dashboard lists booking requests with pending requests first; an administrator can approve or reject each pending request, manage venues, and check room availability for a selected date and time. The shared Neon database stores the admin account, bookings, and login sessions, so sessions work across Vercel Function instances.

Vercel serves browser assets from `public/` and runs the exported Express application from `server.js`. Vercel Hobby and Neon Free have provider-specific usage limits and may sleep/scale to zero; this setup is for a student project and is not an unlimited or availability-guaranteed campus service.

## Local development

No PostgreSQL installation is required. Run `database/schema.sql` against the Neon database first. Copy `.env.example` to `.env`, then enter the Neon pooled `DATABASE_URL` and generate separate random values for `SESSION_SECRET` and `ADMIN_SETUP_KEY` as shown above. Keep `.env` private and never share or commit it. Start the site:

```powershell
npm install
npm run dev
```

The local app is served at `http://127.0.0.1:3000`. Do not commit `.env`; it is ignored by Git.

Create the first local administrator at `http://127.0.0.1:3000/admin/setup`, then sign in at `http://127.0.0.1:3000/admin/login`. After setup, remove `ADMIN_SETUP_KEY` from `.env` so the one-time setup page is disabled.

For a live public service, configure Vercel Firewall rate limiting and monitor both Vercel and Neon usage. The in-process login limiter is an additional per-function-instance guard, not a shared global limit across all serverless instances.
