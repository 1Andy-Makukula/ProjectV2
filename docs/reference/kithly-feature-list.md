# KithLy MVP — Complete Feature & Element Master List

---

## ROLES IN THE SYSTEM

1. Sender (default authenticated user)
2. Recipient (no account needed, accessed via link)
3. Merchant (created by admin, has shop-scoped view)
4. Admin/Superadmin (you, full platform control)

---

## AUTHENTICATION SYSTEM

- Email and password signup
- Email and password login
- Password show/hide toggle
- Forgot password (triggers Supabase reset email)
- Auto role detection on login and redirect accordingly
  - Sender goes to home
  - Merchant goes to merchant dashboard
  - Admin goes to admin panel
- Session persistence across page refreshes
- Logout from all views
- Route protection (unauthenticated users redirected to login)
- Supabase Auth as the engine
- User record created in users table on signup with role defaulting to sender

---

## DATABASE TABLES

**users**
- id
- name
- email
- phone
- role (sender, merchant, admin)
- created_at

**shops**
- id
- name
- description
- location (area or neighbourhood)
- address (full address)
- image_url
- payout_method (airtel, mtn, bank)
- payout_details (mobile number or bank account)
- is_active (boolean)
- created_at

**items**
- id
- shop_id (foreign key)
- name
- description
- price (integer in lowest unit)
- currency (default ZMW)
- image_url
- is_available (boolean)
- created_at

**orders**
- id
- sender_id (foreign key)
- shop_id (foreign key)
- item_id (foreign key)
- recipient_name
- recipient_phone
- message (optional)
- code (unique 6-character uppercase alphanumeric)
- status (pending_payment, payment_submitted, paid, fulfilled, expired)
- amount
- currency
- flutterwave_tx_ref (unique)
- flutterwave_transaction_id
- created_at
- paid_at
- fulfilled_at

**merchant_shops**
- id
- user_id (foreign key)
- shop_id (foreign key)
- created_at

---

## SUPABASE CONFIGURATION

- Row Level Security enabled
- Senders read and create only their own orders
- Merchants read and update only orders belonging to their shop
- Admin has full access to all tables
- Public read on orders table filtered by code only (for recipient gift page, no auth required)
- Supabase Storage bucket for shop and item images
- Real-time subscriptions enabled on orders table
- Auth trigger that creates user record in users table on signup

---

## PAGES — COMPLETE LIST (22 PAGES)

---

### PUBLIC PAGES (No login required)

---

**Page 1 — Landing Page**
Route: /

Elements:
- KithLy logo
- Headline: Send real experiences to the people you love, anywhere
- Subheadline: one to two sentences explaining the concept
- Three icon cards explaining Buy, Send, Receive simply
- Get Started button routing to signup
- Already have an account link routing to login
- Mobile first clean design
- No feed, no shop browsing, no complexity

---

**Page 2 — Sign Up**
Route: /signup

Elements:
- KithLy logo
- Full name input
- Email input
- Phone number input with country code defaulting to +260
- Password input with show/hide toggle
- Confirm password input
- Create Account button
- Already have an account link to login
- Validation: all fields required, email format, password minimum 8 characters, passwords must match
- On success redirects to home

---

**Page 3 — Login**
Route: /login

Elements:
- KithLy logo
- Email input
- Password input with show/hide toggle
- Login button
- Forgot password link triggering Supabase password reset email
- Do not have an account link to signup
- On success checks role and redirects accordingly

---

**Page 4 — Recipient Gift Page**
Route: /gift/[code]

Elements:
- No login required, accessible by anyone with the link
- Full screen celebratory entrance animation on load (gift box opening or warm glow)
- Heading: You have received a gift
- From: sender name displayed clearly
- Personal message if included, styled in a card with quote styling
- Item name and shop name displayed clearly
- Item image displayed prominently
- Status indicator:
  - If pending_payment or payment_submitted: warm message saying gift is being confirmed, check back soon, subtle loading indicator
  - If paid: QR code displayed prominently with 6-character code below in large readable text
  - If fulfilled: completion message saying you have collected this gift, hope you enjoyed it
- Instruction text: Show this screen at shop name to collect your gift
- Shop address displayed below
- KithLy branding subtle at bottom
- Real-time Supabase subscription so QR appears automatically when status changes to paid without page refresh
- Gift box bounce animation when status is paid
- No login required anywhere on this page

---

### SENDER PAGES (Login required)

---

**Page 5 — Home / Shop Discovery**
Route: /home

Elements:
- Top navigation bar with KithLy logo, greeting with sender first name, settings icon
- Section heading: What would you like to send?
- Shop cards in vertical list each containing:
  - Shop cover image
  - Shop name
  - Shop location or short description
  - Number of available items shown as subtle badge
- Tapping a shop navigates to that shop's item page
- Empty state if no active shops with friendly message
- Only shops where is_active is true are shown

---

**Page 6 — Shop Detail / Item Selection**
Route: /shop/[shopId]

Elements:
- Back arrow to home
- Shop image as banner at top
- Shop name as heading
- Shop description and address below
- Item grid or list showing each item with:
  - Item image square or rectangular with rounded corners
  - Item name
  - Price in Kwacha displayed clearly
  - Send button on each available item
- Unavailable items shown greyed out with Unavailable label instead of Send button
- Tapping Send navigates to send flow for that item

---

**Page 7 — Send Flow / Recipient Details**
Route: /send/[itemId]

Elements:
- Back arrow
- Heading: Who are you sending this to?
- Item summary card at top showing item image, name, shop name, price
- Recipient name input
- Recipient phone number input with country code selector
- Message input optional with placeholder and 200 character limit
- Character counter below message field
- Continue button navigating to order summary
- Validation: recipient name required, recipient phone required

---

**Page 8 — Order Summary**
Route: /summary

Elements:
- Heading: Review your order
- Item image
- Item name
- Shop name
- Price
- Recipient name
- Recipient phone
- Message if entered
- Info box explaining KithLy escrow protection clearly: Your payment is held securely until your recipient collects their gift. If uncollected you are protected.
- Edit button to go back and change details
- Pay Now button initiating Flutterwave payment
- On Pay Now: generate unique tx_ref, create order record with status pending_payment, generate 6-character unique code, call Flutterwave API, redirect to Flutterwave hosted page

---

**Page 9 — Payment (Flutterwave Hosted)**

This is Flutterwave's own page. No code written by us. User completes payment here. Flutterwave redirects back to confirmation page. Flutterwave simultaneously sends webhook to backend.

---

**Page 10 — Order Confirmation / Celebratory Screen**
Route: /confirmation/[orderId]

Elements:
- Full screen confetti animation on page load using canvas-confetti in green and gold colours, lasts three seconds then settles
- Large checkmark or gift icon with warm animation fading in after confetti settles
- Heading: Gift sent successfully
- Subheading: recipient name will love this
- Summary card showing item, shop, amount
- 6-character code displayed clearly
- Large WhatsApp Share button generating pre-written message and link
- Copy Link button copying gift page URL to clipboard
- Subtle message: You will be notified when your gift is collected
- View My Orders link to order history

WhatsApp message format:
Hi recipient name, sender name has sent you a gift from shop name. Tap the link to see what you have received and collect it in person. gift page URL

---

**Page 11 — Order History**
Route: /orders

Elements:
- Heading: My Orders
- List of all sender orders showing:
  - Item name and shop name
  - Recipient name
  - Amount paid
  - Status badge colour coded: pending_payment yellow, payment_submitted amber, paid blue, fulfilled green, expired grey
  - Date created
  - Tap any order to see full detail
- Empty state with friendly message and browse shops button

---

**Page 12 — Order Detail**
Route: /orders/[orderId]

Elements:
- Back arrow to order history
- Item image
- Item name and shop
- Recipient name, phone, and message
- Status with colour coding
- Amount paid
- Date paid
- Date fulfilled if applicable
- Gift page link with copy button
- WhatsApp share button to resend link

---

**Page 13 — Settings**
Route: /settings

Elements:
- Heading: Settings
- Account section:
  - Display name field editable inline
  - Email field editable inline
  - Phone number field editable inline
  - Save Changes button
- Security section:
  - Change Password option triggering Supabase reset email
- Danger zone section:
  - Logout button
- KithLy version number subtle at bottom

---

### MERCHANT PAGES (Login required, role merchant)

---

**Page 14 — Merchant Dashboard**
Route: /merchant

Elements:
- Top bar with shop name and KithLy logo
- Analytics summary section at top with four cards counting up from zero on load:
  - Total orders fulfilled all time
  - Total value fulfilled all time in Kwacha
  - Orders fulfilled this week
  - Value fulfilled this week
- Tab system with two sections:
  - Active Orders: all orders with status paid not yet fulfilled
  - Fulfilled Orders: completed orders
- Each active order card shows:
  - Item name
  - Recipient name
  - Order code in large text
  - Time since order was paid
  - Fulfill This Order button
- Each fulfilled order card shows:
  - Item name
  - Recipient name
  - Date fulfilled
  - Amount
- Empty states for both tabs
- Real-time Supabase subscription so new paid orders appear without page refresh
- Analytics numbers count up from zero each session for psychological reinforcement

---

**Page 15 — Merchant Fulfill**
Route: /merchant/fulfill

Elements:
- Heading: Redeem a Gift
- Large text input for 6-character code with auto capitalisation
- Scan QR Code button activating device camera to scan QR, reads code, populates input field automatically
- Redeem button below input
- On successful redemption:
  - Green success screen with checkmark animation drawing itself
  - Shows item name and recipient name
  - Confirmation: Gift redeemed successfully
  - Button to redeem another
- On invalid code:
  - Red error state
  - Message: This code is invalid or has already been used
- On code found but status not paid:
  - Amber warning state
  - Message: This gift has not yet been paid for and cannot be redeemed
- Code locked to the specific shop: only that merchant can redeem, no other shop can redeem it

---

### ADMIN / SUPERADMIN PAGES (Login required, role admin)

---

**Page 16 — Admin Overview Dashboard**
Route: /admin

Elements:
- Top navigation linking to all admin sections
- Summary analytics cards at top:
  - Total orders all time
  - Total value processed all time
  - Orders this week
  - Value this week
  - Total active shops
  - Total registered users
  - Total fulfilled orders
  - Total pending orders
  - Total expired orders
- Recent activity feed showing last 20 orders across all shops with status, amount, shop name, sender name, time
- Quick links to all admin sections: Shops, Items, Users, Orders, Merchants
- Export all data to CSV button

---

**Page 17 — Admin Shops Management**
Route: /admin/shops

Elements:
- Heading: Shops
- Add New Shop button top right
- Table or list of all shops showing:
  - Shop image thumbnail
  - Shop name
  - Location
  - Number of active items
  - Active or Inactive status badge
  - Edit button
  - Deactivate or Activate toggle
- Each row tappable to see full shop detail
- Search bar to filter shops by name

---

**Page 18 — Admin Create and Edit Shop**
Route: /admin/shops/new and /admin/shops/[shopId]/edit

Elements:
- Heading: New Shop or Edit Shop
- Shop name input
- Description textarea
- Location input neighbourhood or area
- Full address input
- Shop image upload using Supabase Storage with preview shown after upload
- Payout method selector: Airtel Money, MTN, Bank Transfer
- Payout details input: mobile number for mobile money or bank account for bank transfer
- Active toggle
- Save button
- Cancel button
- Delete shop button on edit page (with confirmation dialog)

---

**Page 19 — Admin Items Management**
Route: /admin/shops/[shopId]/items

Elements:
- Shop name as heading with back arrow to shops list
- Add New Item button
- List of all items for this shop showing:
  - Item image thumbnail
  - Item name
  - Price
  - Available or Unavailable badge
  - Edit button
  - Toggle availability

---

**Page 20 — Admin Create and Edit Item**
Route: /admin/shops/[shopId]/items/new and /admin/items/[itemId]/edit

Elements:
- Item name input
- Description textarea
- Price input with ZMW currency label
- Item image upload with preview using Supabase Storage
- Available toggle
- Save button
- Cancel button
- Delete item button on edit page with confirmation dialog

---

**Page 21 — Admin Merchant Account Management**
Route: /admin/merchants

Elements:
- Heading: Merchants
- Create Merchant Account button
- List of merchant accounts showing:
  - Merchant name
  - Email
  - Linked shop name
  - Date created
  - Edit button
  - Reset password button triggering Supabase reset email to merchant

Create merchant form elements:
- Merchant full name
- Email address for their login
- Temporary password generated and shareable
- Shop selector dropdown linking merchant to one of your shops
- Create Account button

What it does: uses Supabase admin auth API to create user programmatically, sets role to merchant, creates record in merchant_shops table linking user to shop. Merchant uses email and temporary password to log in.

---

**Page 22 — Admin All Orders**
Route: /admin/orders

Elements:
- Heading: All Orders
- Filter bar: All, Pending Payment, Payment Submitted, Paid, Fulfilled, Expired
- Search input: search by code, sender name, or recipient name
- Table of all orders showing:
  - Order code
  - Item name
  - Shop name
  - Sender name
  - Recipient name
  - Amount
  - Status badge colour coded
  - Date created
  - Date fulfilled if applicable
- Tap any row to see full order detail
- Export to CSV button
- Manual Mark as Paid button on orders with status payment_submitted (this is how you confirm Airtel Money payments)
- Manual Mark as Expired button for admin cleanup

---

**Page 23 — Admin Order Detail**
Route: /admin/orders/[orderId]

Elements:
- Full order detail view
- All order fields displayed
- Status with colour coding
- Manual status controls:
  - Mark as Paid button if payment_submitted
  - Mark as Fulfilled button if paid (backup in case merchant has trouble)
  - Mark as Expired button
- Gift page link with copy button
- Sender contact details
- Recipient contact details
- Item and shop details
- Flutterwave transaction reference displayed
- Timestamps for each status change

---

## PAYMENT FLOW — COMPLETE TECHNICAL SEQUENCE

1. Sender taps Pay Now
2. App generates unique tx_ref string: KITHLY-timestamp-randomstring
3. App creates order record with status pending_payment and stores tx_ref and generated 6-character code
4. App calls Flutterwave payment initialisation endpoint with amount, currency ZMW, customer details, tx_ref, redirect URL pointing to confirmation page
5. Flutterwave returns payment link
6. App redirects user to Flutterwave hosted payment page
7. User completes payment on Flutterwave page using card, Airtel Money, MTN, or bank transfer
8. Flutterwave sends webhook POST to your backend at /api/webhooks/flutterwave
9. Webhook endpoint verifies Flutterwave signature header
10. Webhook finds order by tx_ref
11. Webhook updates order status from pending_payment to paid and sets paid_at
12. Flutterwave redirects user to confirmation page with tx_ref in URL
13. Confirmation page fetches order and shows celebration screen

Manual payment confirmation (Airtel direct):
When sender chooses Airtel direct and clicks I Have Paid, status updates to payment_submitted. Admin sees this in orders table and manually clicks Mark as Paid after verifying Airtel balance. This triggers same outcome as webhook.

Merchant payouts:
Manual via Flutterwave dashboard referencing payout_details stored per shop. Triggered after admin sees fulfilled orders. Automated payout via Flutterwave transfer API added in version two.

---

## WHATSAPP SHARE IMPLEMENTATION

URL format: https://wa.me/?text=URL-encoded message

Message constructed as: Hi recipient name, sender name sent you a gift from shop name on KithLy. Tap here to see what you have received and show it when you collect: gift page URL

Gift page URL: https://yourdomain.com/gift/order code

Opens WhatsApp on sender phone with message pre-filled. Sender chooses contact. No API, no cost, works immediately.

---

## REAL-TIME SUBSCRIPTIONS (SUPABASE)

Two real-time subscriptions in the MVP:

First: Recipient gift page. Subscribe to changes on orders table filtered by order code. When status changes to paid, automatically show QR code without page refresh. When status changes to fulfilled, automatically show completion message.

Second: Merchant dashboard. Subscribe to new orders for merchant's specific shop. When new paid order arrives it appears in active orders list automatically without refresh.

---

## CODE GENERATION LOGIC

6-character code using uppercase letters and numbers excluding ambiguous characters (0, O, 1, I). Before saving check database for collision and regenerate if collision found. Stored in orders table as the single source of truth for redemption. Tied to specific shop_id so no other shop can redeem it.

---

## EMOTIONAL AND CELEBRATORY MOMENTS

**Sender confirmation screen:**
Full confetti animation using canvas-confetti triggered immediately on page load. Warm green and gold colours. Lasts three seconds then settles. Heading and gift summary fade in after confetti settles.

**Recipient gift page:**
Gift box icon does gentle bounce animation on load when status is paid. QR code fades in with soft glow effect. If status is still pending when recipient opens the page, QR code appears automatically with same animation via real-time subscription without refresh.

**Merchant fulfillment success:**
Large animated checkmark drawing itself after successful redemption. Brief and satisfying.

**Merchant analytics dashboard:**
Numbers on analytics cards count up from zero when merchant first opens dashboard each session. Small but psychologically reinforces value being generated for the merchant.

---

## IMAGE HANDLING

Shop images and item images uploaded to Supabase Storage. Public URL stored in image_url field. Images displayed in shop cards, item cards, order summaries, recipient gift page. Fallback placeholder shown if image_url is empty or fails to load. Grey background with No Image text. Same dimensions as normal images. Admin uploads all images through admin panel for MVP. No merchant self-upload in MVP.

---

## NAVIGATION AND ROUTING STRUCTURE

/ — Landing page (public)
/signup — Sign up (public)
/login — Login (public)
/gift/[code] — Recipient gift page (public, no auth)
/home — Shop discovery (sender)
/shop/[shopId] — Shop items (sender)
/send/[itemId] — Send flow (sender)
/summary — Order summary (sender)
/confirmation/[orderId] — Celebration screen (sender)
/orders — Order history (sender)
/orders/[orderId] — Order detail (sender)
/settings — Account settings (sender)
/merchant — Merchant dashboard (merchant)
/merchant/fulfill — Redeem code (merchant)
/admin — Admin overview (admin)
/admin/shops — Shops list (admin)
/admin/shops/new — Create shop (admin)
/admin/shops/[shopId]/edit — Edit shop (admin)
/admin/shops/[shopId]/items — Items list (admin)
/admin/shops/[shopId]/items/new — Create item (admin)
/admin/items/[itemId]/edit — Edit item (admin)
/admin/merchants — Merchant accounts (admin)
/admin/orders — All orders (admin)
/admin/orders/[orderId] — Order detail (admin)

---

## ROW LEVEL SECURITY POLICIES

Senders: read and create only their own orders where sender_id matches auth user id
Merchants: read orders belonging to their shop only, update orders belonging to their shop only when changing status to fulfilled
Admin: full read and write access to all tables
Public: single order read by code only, no authentication required, used for recipient gift page

---

## TECH STACK SUMMARY

Frontend: React with TypeScript
Framework: Next.js App Router
Styling: Tailwind CSS
Auth and Database: Supabase
Storage: Supabase Storage
Payments: Flutterwave
Hosting: Vercel
Notifications: WhatsApp URL scheme, no API
Animations: canvas-confetti for celebrations, Framer Motion for transitions
QR Generation: qrcode.react

---

## ENVIRONMENT VARIABLES NEEDED

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_PUBLIC_KEY
FLW_SECRET_HASH (webhook verification)
NEXT_PUBLIC_APP_URL (for generating gift page links)

---

## WHAT IS EXPLICITLY NOT IN THIS MVP

No feed or content discovery
No bundles or multi-item orders
No scheduling or time-slot booking
No creator accounts or commissions
No reviews or ratings
No map integration
No in-app push notifications
No wallet or stored balance
No automated merchant payouts
No multi-shop single cart
No KithLy Aid, Scholar, Build, or Health verticals
No AI agent layer
No analytics dashboards beyond basic counts
No SMS or WhatsApp API integration (URL scheme only)
No mobile app
No multi-currency beyond ZMW at checkout

---

That is the complete and exhaustive MVP. Nothing more. Nothing left out that matters. Build this and you have something real.