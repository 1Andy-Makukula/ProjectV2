# KithLy Database Setup Instructions

## Required Tables

Run these SQL commands in your Supabase SQL Editor:

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'sender' CHECK (role IN ('sender', 'merchant', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shops table
CREATE TABLE shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  address TEXT,
  image_url TEXT,
  payout_method TEXT CHECK (payout_method IN ('airtel', 'mtn', 'bank')),
  payout_details TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Items table
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  currency TEXT DEFAULT 'ZMW',
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id),
  shop_id UUID REFERENCES shops(id),
  item_id UUID REFERENCES items(id),
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  message TEXT,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'payment_submitted', 'paid', 'fulfilled', 'expired')),
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'ZMW',
  flutterwave_tx_ref TEXT UNIQUE,
  flutterwave_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ
);

-- Merchant shops junction table
CREATE TABLE merchant_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, shop_id)
);

-- Create indexes for performance
CREATE INDEX idx_orders_code ON orders(code);
CREATE INDEX idx_orders_sender ON orders(sender_id);
CREATE INDEX idx_orders_shop ON orders(shop_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_merchant_shops_user ON merchant_shops(user_id);
CREATE INDEX idx_items_shop ON items(shop_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_shops ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can read their own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own data" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can read all users" ON users FOR SELECT USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins can insert users" ON users FOR INSERT WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- RLS Policies for shops table
CREATE POLICY "Everyone can read active shops" ON shops FOR SELECT USING (is_active = true OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins can manage shops" ON shops FOR ALL USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- RLS Policies for items table
CREATE POLICY "Everyone can read items from active shops" ON items FOR SELECT USING (
  EXISTS (SELECT 1 FROM shops WHERE shops.id = items.shop_id AND shops.is_active = true)
  OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "Admins can manage items" ON items FOR ALL USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- RLS Policies for orders table
CREATE POLICY "Anyone can read order by code (for recipient page)" ON orders FOR SELECT USING (true);
CREATE POLICY "Senders can read their own orders" ON orders FOR SELECT USING (sender_id = auth.uid());
CREATE POLICY "Senders can create orders" ON orders FOR INSERT WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Merchants can read their shop orders" ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM merchant_shops WHERE merchant_shops.shop_id = orders.shop_id AND merchant_shops.user_id = auth.uid())
);
CREATE POLICY "Merchants can update their shop orders" ON orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM merchant_shops WHERE merchant_shops.shop_id = orders.shop_id AND merchant_shops.user_id = auth.uid())
);
CREATE POLICY "Admins can manage all orders" ON orders FOR ALL USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- RLS Policies for merchant_shops table
CREATE POLICY "Merchants can read their assignments" ON merchant_shops FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can manage merchant assignments" ON merchant_shops FOR ALL USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- Auth trigger to create user record on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    'sender'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for orders table
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- Create storage bucket for images
INSERT INTO storage.buckets (id, name, public) VALUES ('kithly-images', 'kithly-images', true);

-- Storage policies
CREATE POLICY "Public can view images" ON storage.objects FOR SELECT USING (bucket_id = 'kithly-images');
CREATE POLICY "Admins can upload images" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'kithly-images' AND 
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "Admins can delete images" ON storage.objects FOR DELETE USING (
  bucket_id = 'kithly-images' AND 
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
```

## Environment Variables Needed

Add these to your Supabase Edge Function secrets:

- `FLUTTERWAVE_PUBLIC_KEY` - Your Flutterwave public key
- `FLUTTERWAVE_SECRET_KEY` - Your Flutterwave secret key
- `FLUTTERWAVE_WEBHOOK_SECRET` - Your Flutterwave webhook secret hash

## Test Data (Optional)

```sql
-- Create an admin user (replace with your email after signup)
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```
