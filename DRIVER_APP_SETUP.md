# Time Pulse AI - Driver Mobile App Setup Guide

## 🚨 Critical Setup Requirements

Before the driver mobile app will work, you MUST complete these setup steps:

### 1. Create the driver_credentials Table

Run the SQL in `create_driver_credentials_table.sql` in your Supabase SQL Editor:

```bash
# The SQL file is located at: create_driver_credentials_table.sql
# Go to: Supabase Dashboard → SQL Editor → New Query
# Copy and paste the contents of the file → Run
```

### 2. Set Strong JWT Secret

**CRITICAL SECURITY:** The driver app requires a strong JWT secret to prevent token forgery.

```bash
# Generate a strong secret:
node -e "console.log(require('crypto').randomBytes(64).toString(\'hex\'))"

# Add to Replit Secrets:
# Name: JWT_SECRET
# Value: <the generated secret>
```

### 3. Verify SUPABASE_SERVICE_ROLE_KEY is Set

The driver authentication requires the SERVICE_ROLE_KEY (not anon key) because of RLS policies.

```bash
# Check that this secret exists in Replit Secrets:
# Name: SUPABASE_SERVICE_ROLE_KEY
# Value: <your Supabase service role key from Supabase Dashboard → Settings → API>
```

## 📋 Post-Setup Steps

### For Existing Deliverers (Migration)

If you already have deliverers in your database who don't have passwords yet:

1. They will get a "Primeira configuração necessária" error when trying to login
2. **ADMIN-ONLY**: Use the password setup endpoint to configure initial passwords:

```javascript
// POST /api/driver/auth/setup-password
// REQUIRES ADMIN AUTHENTICATION (Bearer token with role: 'admin')
// Headers: { "Authorization": "Bearer <admin_token>" }
{
  "deliverer_id": "uuid-of-deliverer",  // or use "phone" instead
  "password": "temporary_password_123"
}
```

**⚠️ IMPORTANT SECURITY NOTE:**
- This endpoint requires admin authentication to prevent account takeover
- Admins should set a temporary password and instruct drivers to change it on first login
- Future enhancement: Implement SMS OTP for self-service password setup

**Alternative Migration Strategies:**
1. **Manual Migration**: Admin sets temporary passwords, sends via SMS/email
2. **In-Person Setup**: Drivers visit location to verify identity and set password
3. **SMS OTP** (Future): Implement self-service password setup with phone verification

### For New Deliverers

New deliverers can register directly through the app at `/driver.html` with:
- Name
- Phone
- CPF
- Motorcycle Plate
- Password (minimum 6 characters)

## 🔐 Security Features

✅ **bcrypt password hashing** (10 salt rounds)
✅ **JWT tokens** with strong secret (30 day expiration)
✅ **Row Level Security** on driver_credentials table
✅ **Service role authentication** for sensitive operations
✅ **Password strength validation** (minimum 6 characters)
✅ **Duplicate phone prevention**
✅ **Transaction rollback** on failed registrations

## 📱 API Endpoints

### Authentication
- `POST /api/driver/auth/login` - Driver login
- `POST /api/driver/auth/register` - New driver registration
- `POST /api/driver/auth/setup-password` - Password setup for existing drivers

### Orders
- `GET /api/driver/orders/available` - Get available orders
- `GET /api/driver/orders/active` - Get active deliveries
- `POST /api/driver/orders/:id/accept` - Accept an order
- `POST /api/driver/orders/:id/reject` - Reject an order
- `PUT /api/driver/orders/:id/status` - Update order status

### Location & Status
- `PUT /api/driver/location` - Update GPS location
- `PUT /api/driver/status` - Update online/offline status

### Financial
- `GET /api/driver/earnings` - Get earnings dashboard
- `GET /api/driver/history` - Get delivery history
- `POST /api/driver/withdrawal` - Request withdrawal

### Heat Map
- `GET /api/driver/heatmap` - Get order density data

## 🌐 Access the Driver App

Once setup is complete, drivers can access the app at:

```
https://your-replit-url.repl.co/driver.html
```

## 🔧 Troubleshooting

### "Missing required Supabase configuration"
- Check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in Replit Secrets

### "JWT_SECRET must be configured"
- Generate and set a strong JWT_SECRET (see step 2 above)
- Never use the default secret in production

### "driver_credentials table does not exist"
- Run the SQL file in Supabase SQL Editor (see step 1 above)

### Login returns "Primeira configuração necessária"
- Existing deliverer needs to setup password using `/api/driver/auth/setup-password`

## 📊 Monitoring

Check server logs for:
- `🚗 Driver Mobile App API routes mounted` - Routes loaded successfully
- `❌ CRITICAL` errors - Configuration issues that prevent driver auth from working
- `⚠️ Failed to mount driver routes` - Driver features disabled due to missing config

## 🚀 Next Steps

After setup, consider:
1. **Firebase Cloud Messaging** - Add push notifications for new orders
2. **Mapbox Token** - Configure for route visualization (already integrated)
3. **Asaas Integration** - Complete withdrawal flow with payment processing
4. **Heat Map Data** - Populate with real order data for strategic positioning
