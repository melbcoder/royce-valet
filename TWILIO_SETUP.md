# Twilio SMS Integration Setup

## Local Development

1. The `.env` file contains your Twilio credentials (already created)
2. Update `VITE_APP_URL` in `.env` with your local URL (default: http://localhost:5173)
3. Run `npm run dev` to start the development server

## Vercel Deployment

### Add Environment Variables to Vercel:

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variables:

```
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
VITE_APP_URL=https://your-domain.vercel.app
```

4. Make sure to set these for **Production**, **Preview**, and **Development** environments

### Important Notes:

- **Never commit the `.env` file** - it's already in `.gitignore`
- When you get a new Twilio number, update `TWILIO_PHONE_NUMBER` in Vercel's environment variables
- Update `VITE_APP_URL` with your actual production domain

## How It Works

When a vehicle is added to the system:
1. The vehicle is created in Firestore
2. An SMS is sent to the guest's phone number containing:
   - Their valet tag number
   - A direct link to track their vehicle: `https://your-domain.com/guest/{tag}`

## Testing

To test locally, you can use your Twilio test number. The SMS will be sent to the guest's phone number when you create a vehicle in the system.

## Phone Number Format

Phone numbers should be in E.164 format: `+1234567890`
- Include the country code
- No spaces, dashes, or parentheses
