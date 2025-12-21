# Testing Twilio SMS Locally

## Problem
The `/api` routes don't work with Vite's dev server. You need to use Vercel CLI to test locally.

## Solution: Use Vercel CLI

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Link your project
```bash
vercel link
```
Follow the prompts to link to your existing Vercel project.

### 3. Pull environment variables
```bash
vercel env pull
```
This will create a `.env.local` file with your Vercel environment variables.

### 4. Run with Vercel Dev
```bash
vercel dev
```
This starts a local development server that supports the `/api` routes.

## Alternative: Test on Production

Since you've already pushed the code to GitHub and it's connected to Vercel:

1. Make sure you've added the environment variables in Vercel dashboard
2. Wait for the deployment to complete
3. Test by adding a vehicle on your production site

The SMS will work on production as long as:
- Environment variables are set in Vercel
- Phone number is in correct format: +1234567890

## Debugging Checklist

1. **Check browser console** - Look for the console.log messages when you create a vehicle
2. **Verify phone format** - Must be E.164 format: `+1234567890` (country code + number, no spaces)
3. **Check Vercel deployment logs** - Go to Vercel dashboard → Deployments → Functions tab
4. **Check Twilio logs** - If the function is called but no SMS, check Twilio console

## Phone Number Format Examples
- ✅ Correct: `+16592773142`
- ❌ Wrong: `6592773142`
- ❌ Wrong: `(659) 277-3142`
- ❌ Wrong: `+1 659-277-3142`
