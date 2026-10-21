# RS Fabrication Billing

A private, single-business billing app built with Next.js and MongoDB. It includes the invoice, quotation, purchase, payments, party/item, GST-report, settings, PDF, CSV, and JSON-backup workflows from the original HTML app.

## Run locally

Requirements: Node.js 20.9 or later and a MongoDB database. MongoDB Atlas free tier works for evaluation.

1. Create a MongoDB Atlas cluster and database user. Allow the deployment's IP address in Atlas Network Access. For local development, add your current IP rather than opening database access to everyone.
2. Copy `.env.example` to `.env.local`.
3. Set `MONGODB_URI` to the Atlas connection string. Keep the database password URL-encoded when it contains reserved URL characters.
4. Set `SESSION_SECRET` to a random secret with at least 32 characters. For example, in PowerShell:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

5. Install and run:

   ```powershell
   npm install
   npm run dev
   ```

6. Open the local site and create the first administrator account. Use a unique username and a strong password of at least 12 characters. The setup screen is disabled after the first account is created.

The first development request compiles the app and may take a few seconds; later requests should be faster. Development and production builds use separate Next.js cache folders to avoid dev-manifest conflicts. Atlas may also take longer on the first database connection.

### Forgot the admin password

From the project folder, run `npm run admin:reset` in an interactive terminal. It resets the existing admin password without changing business records; the new password is entered without displaying it, and the admin username is shown when the reset succeeds. This command reads `.env.local`, so make sure it contains the correct `MONGODB_URI`. Restart the app if needed, then sign in with the displayed username and the new password. Do not run this command on a deployed database unless you intentionally want to change that account's password.

## Deploy to Vercel

This is a full-stack Next.js app: the UI and `/api/auth` and `/api/data` backend routes deploy together. **No separate Render backend is needed.** MongoDB Atlas remains the external database.

1. Push the project to a GitHub repository. Confirm `.env.local` is not committed; `.gitignore` excludes local environment files.
2. In Vercel, choose **Add New → Project**, import that GitHub repository, and leave the framework preset as **Next.js**. The project root is the repository root; use the default build settings.
3. Before deploying, open **Project → Settings → Environment Variables** and add these for **Production**:
   - `MONGODB_URI`: the complete Atlas connection string, with reserved characters in the database password URL-encoded.
   - `SESSION_SECRET`: a newly generated random secret of at least 32 characters. Generate one locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and paste it directly into Vercel. Never put either value in source code or share it in chat.
4. In Atlas, create a database user limited to the app's database and configure **Network Access** so Vercel can reach the cluster. Prefer a static Vercel egress IP allowlist when available. If the selected Vercel plan has no fixed outbound IP, Atlas may require `0.0.0.0/0`; that permits connections from any IP, so use a strong unique database password and least-privilege database user.
5. Deploy from Vercel. After deployment, open the URL and verify the login screen and sign-in. Vercel environment changes require a redeployment.

If you connect the same Atlas database already used locally, its admin account and billing records remain in that database. The first-account setup screen will not appear again; sign in with the existing admin credentials. To start a separate business database, use a separate database name/URI and create its first admin on the new deployment. Rotate any database password that has been shared or exposed, then update the Vercel `MONGODB_URI` value and redeploy.

Use a persistent MongoDB service such as Atlas. Do not deploy this app with an ephemeral/local database. Business records and the last-backup date are stored in MongoDB.

### Install on Android or iPhone/iPad

Install the deployed site over HTTPS; local `http://localhost` is suitable only for development.

- **Android:** Open the Vercel URL in Chrome, sign in, tap **Install app** (or use Chrome's menu → **Install app** / **Add to Home screen**) and confirm.
- **iPhone/iPad:** Open the URL in Safari, sign in, tap **Install app** for instructions, then use **Share → Add to Home Screen → Add**. iOS requires this Safari share-sheet flow.

The app includes platform icons, standalone display settings, and a service worker. It shows a small offline page when the site cannot be reached. Billing data and API responses are never cached offline; an internet connection is required to access saved business data. Install the production HTTPS deployment for the intended experience; service-worker registration is disabled during local development.

## Move data from the original HTML app

The old HTML app stores its business records in the browser on the device where it was used; those records are not automatically present in MongoDB. On that device:

1. Open `RS-Fabrication-Billing.html`.
2. Go to **Settings → Download backup** and save its JSON backup.
3. In this app, sign in, open **Settings → Restore from backup**, and choose that JSON file.
4. Confirm the import, then check business settings and sample invoices before relying on the reports.

The import preserves the old backup format (`co`, `parties`, `items`, and `docs`) and merges records by ID. Download a new backup after importing. Company and bank details are intentionally not embedded in source code; configure them in Settings or import them from your private backup.

## Included pages and features

- **Dashboard:** current financial year sales, current-month sales, amounts to receive/pay, purchase total, GST cash estimate, open quotations, recent documents, and backup reminder.
- **Invoices:** create, edit, duplicate, cancel/restore, delete, print/download PDF, add/remove payments, and track outstanding balance.
- **Quotations:** create/edit/duplicate/delete, validity/expiry, PDF, and convert a quotation into an invoice.
- **Purchases:** supplier bills, supplier payments, IGST, reverse charge, and outstanding balance.
- **GST reports:** monthly/quarterly/financial-year GSTR-1, GSTR-3B, and purchase register; warnings and CSV exports.
- **Customers & suppliers:** customer/supplier/both roles, contact/tax details, search, and billed totals.
- **Items:** saved work/material details, HSN/SAC, unit, rate, and GST defaults.
- **Settings:** business and bank details, number prefixes, due/validity defaults, terms, password change, JSON backup/restore, and erase-all-data confirmation.

GST calculations are estimates based on the records entered here; verify them against source documents and the GST portal before filing. Credit/debit notes, amendments, interest, and late fees are not included.
