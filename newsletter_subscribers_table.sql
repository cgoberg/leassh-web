-- Newsletter subscribers table for email capture functionality
-- This needs to be created in Supabase database

CREATE TABLE newsletter_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  gdpr_consent BOOLEAN DEFAULT false NOT NULL,
  source VARCHAR(50) DEFAULT 'homepage' NOT NULL,
  unsubscribed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create index on email for fast lookups
CREATE INDEX idx_newsletter_subscribers_email ON newsletter_subscribers(email);

-- Create index on subscribed_at for analytics
CREATE INDEX idx_newsletter_subscribers_subscribed_at ON newsletter_subscribers(subscribed_at);

-- RLS policies (adjust based on your Supabase setup)
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Allow public inserts for new subscriptions
CREATE POLICY "Allow public newsletter subscription" ON newsletter_subscribers
  FOR INSERT WITH CHECK (true);

-- Allow service role to read for admin purposes
CREATE POLICY "Allow service role to read subscribers" ON newsletter_subscribers
  FOR SELECT USING (auth.role() = 'service_role');