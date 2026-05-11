# KithLy - Professional Gift Marketplace

Send real experiences to the people you love, anywhere in Zambia.

## Overview

KithLy is a gift marketplace platform that allows users to:
- **Senders**: Browse local shops, purchase gifts, and send them to recipients via WhatsApp
- **Recipients**: Receive gift links, view their gifts, and collect them in person using QR codes
- **Merchants**: Manage their shop's orders and redeem gifts via QR code scanning
- **Admins**: Manage shops, items, merchants, and oversee all platform operations

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives with custom styling
- **Animations**: Motion (Framer Motion)
- **Backend**: Supabase (Auth, Database, Storage, Real-time)
- **Edge Functions**: Supabase Edge Functions (Deno + Hono)
- **Payments**: Flutterwave
- **QR Codes**: qrcode library
- **Celebrations**: canvas-confetti

## Database Setup

### 1. Run the SQL Setup

Open your Supabase SQL Editor and run all commands from:
```
supabase/DATABASE_SETUP.md
```

This will create:
- All required tables (users, shops, items, orders, merchant_shops)
- Row Level Security policies
- Auth trigger for automatic user creation
- Realtime subscriptions
- Storage bucket for images

### 2. Set Environment Variables

In your Supabase Edge Function secrets, add:

```bash
FLUTTERWAVE_PUBLIC_KEY=your_public_key_here
FLUTTERWAVE_SECRET_KEY=your_secret_key_here
FLUTTERWAVE_WEBHOOK_SECRET=your_webhook_secret_here
APP_URL=https://your-app-domain.com
```

### 3. Deploy Edge Function

The server code is in `supabase/functions/server/index.tsx`. Deploy it using:

```bash
supabase functions deploy server
```

## User Roles

### Sender (Default)
- Browse shops and items
- Send gifts to recipients
- Track order status
- Manage account settings

### Merchant
- View dashboard with analytics
- See active and fulfilled orders
- Redeem gifts via QR code scanning
- Real-time order notifications

### Admin
- Full platform oversight
- Manage shops and items
- Create merchant accounts
- Manual payment confirmation
- View all orders and analytics

## Key Features

### Payment Flow
1. Sender selects item and enters recipient details
2. Order created with unique 6-character code
3. Flutterwave payment initialization
4. User redirects to Flutterwave hosted page
5. Webhook updates order status to "paid"
6. Recipient receives WhatsApp link to gift page

### Real-time Features
- **Recipient gift page**: Auto-updates when payment confirmed (QR code appears)
- **Merchant dashboard**: New orders appear instantly without refresh

### Security
- Row Level Security on all tables
- Senders only see their own orders
- Merchants only access their shop's orders
- Admins have full access
- Public can view orders only by code (for recipient page)

### Celebratory Moments
- **Confirmation page**: Full-screen confetti animation (green & gold)
- **Gift page**: Gift box bounce animation when status = paid
- **Merchant fulfillment**: Animated checkmark on success

## Development

### Install Dependencies
```bash
pnpm install
```

### Run Development Server
The Vite dev server is already running in the Make environment. Access the preview pane to view the app.

### Project Structure
```
src/
├── app/
│   ├── components/
│   │   ├── ui/           # Radix UI components
│   │   ├── layout/       # (currently unused, simplified layout)
│   │   └── shared/       # Shared components
│   ├── pages/
│   │   ├── public/       # Landing, Login, SignUp, GiftPage
│   │   ├── sender/       # Sender role pages
│   │   ├── merchant/     # Merchant role pages
│   │   └── admin/        # Admin role pages
│   ├── layouts/
│   │   └── Root.tsx      # Root layout with AuthProvider
│   └── routes.tsx        # Route configuration
├── utils/
│   ├── auth/
│   │   └── AuthContext.tsx    # Authentication context
│   ├── supabase/
│   │   ├── client.tsx          # Supabase client singleton
│   │   └── info.tsx            # Auto-generated credentials
│   ├── codeGenerator.ts        # Order code generation
│   ├── currency.ts             # Currency formatting
│   └── whatsapp.ts             # WhatsApp share links
└── components/
    └── ProtectedRoute.tsx      # Role-based route protection

supabase/
└── functions/
    └── server/
        ├── index.tsx           # Hono server with payment endpoints
        └── kv_store.tsx        # Auto-generated KV store (DO NOT EDIT)
```

## First-time Setup

### 1. Create Admin User
After signing up, run this SQL command in Supabase to make yourself an admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

### 2. Add Shops and Items
As admin, navigate to `/admin` and:
1. Create shops
2. Add items to shops
3. Upload images for shops and items

### 3. Create Merchant Accounts
Navigate to `/admin/merchants` to create merchant accounts and link them to shops.

## WhatsApp Integration

Uses WhatsApp's URL scheme (no API required):
```
https://wa.me/?text={encoded_message}
```

Opens WhatsApp with pre-filled message containing gift link.

## Payment Integration Notes

- **Default**: Flutterwave handles card, mobile money, bank transfer
- **Manual Confirmation**: For Airtel Money direct payments, admin can manually mark orders as "paid" in the admin panel
- **Escrow Protection**: Payments held until recipient collects gift

## Code Generation

Order codes are:
- 6 characters long
- Uppercase letters and numbers only
- Excludes ambiguous characters (0, O, 1, I)
- Checked for uniqueness before saving

## Image Storage

- Shop and item images stored in Supabase Storage
- Bucket: `kithly-images` (public)
- Admins can upload images via admin panel
- Fallback placeholder shown if image missing

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Auto-generated by Make | ✅ |
| `SUPABASE_ANON_KEY` | Auto-generated by Make | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-generated by Make | ✅ |
| `FLUTTERWAVE_PUBLIC_KEY` | Flutterwave public API key | ✅ |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave secret key | ✅ |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Webhook verification hash | ✅ |
| `APP_URL` | Your app's public URL | ✅ |

## API Endpoints

### Payment
- `POST /make-server-468852b1/payment/initialize` - Initialize Flutterwave payment
- `POST /make-server-468852b1/webhooks/flutterwave` - Payment webhook
- `POST /make-server-468852b1/orders/:orderId/confirm-payment` - Manual payment confirmation (admin only)

### Health
- `GET /make-server-468852b1/health` - Server health check

## Known Limitations (MVP)

This is a Minimum Viable Product. The following are NOT included:
- No bundles or multi-item orders
- No scheduling or time-slot booking
- No reviews or ratings
- No map integration
- No in-app push notifications
- No wallet or stored balance
- No automated merchant payouts (manual via Flutterwave dashboard)
- No multi-currency support (ZMW only)
- No SMS integration
- No mobile app

## Support

For issues or questions about KithLy:
1. Check the database setup in `supabase/DATABASE_SETUP.md`
2. Verify all environment variables are set correctly
3. Check Supabase logs for errors
4. Review the server logs in Supabase Edge Functions

## License

Private - All Rights Reserved

---

Built with ❤️ for sending real experiences in Zambia.
