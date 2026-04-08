const supabase = require('../_lib/supabase');
const { sendEmail } = require('../_lib/email');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, gdpr_consent } = req.body;

    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Check GDPR consent
    if (!gdpr_consent) {
      return res.status(400).json({ error: 'GDPR consent required' });
    }

    // Check if email already exists
    const { data: existing, error: checkError } = await supabase
      .from('newsletter_subscribers')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is "row not found", which is what we want
      console.error('Database check error:', checkError);
      return res.status(500).json({ error: 'Sorry, we\'re having trouble with our servers right now. Please try again in a few minutes.' });
    }

    if (existing) {
      // Already subscribed, but don't reveal this for privacy
      return res.status(200).json({ success: true, message: 'Subscription confirmed' });
    }

    // Insert new subscriber
    const { error: insertError } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: email.toLowerCase(),
        subscribed_at: new Date().toISOString(),
        gdpr_consent: true,
        source: req.body.source || 'homepage'
      });

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'We couldn\'t complete your subscription right now. Please try again in a few minutes.' });
    }

    // Send welcome email
    await sendEmail({
      to: email,
      subject: 'Welcome to Leassh updates',
      text: `Hi there!

Thanks for subscribing to Leassh updates. You'll be among the first to know about new features, parenting tech insights, and family digital wellness tips.

What Leassh does:
• AI-powered activity reports that help you understand (not surveil) your child's digital life
• Screen time tracking with gentle time limits
• 100% local privacy option — no data leaves your network
• Works on Windows, macOS, and Linux

Ready to try it? Start your 14-day free trial: https://leassh.com/setup

Questions? Just reply to this email.

Best,
Carl-Gustav
Founder, Leassh

---
You can unsubscribe anytime by replying with "unsubscribe".`,
      html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
        <h2 style="color: #d4a24c; margin-bottom: 24px;">Welcome to Leassh updates!</h2>

        <p>Hi there!</p>

        <p>Thanks for subscribing to Leassh updates. You'll be among the first to know about new features, parenting tech insights, and family digital wellness tips.</p>

        <h3 style="color: #444; margin-top: 32px; margin-bottom: 16px;">What Leassh does:</h3>
        <ul style="margin-bottom: 24px;">
          <li>AI-powered activity reports that help you understand (not surveil) your child's digital life</li>
          <li>Screen time tracking with gentle time limits</li>
          <li>100% local privacy option — no data leaves your network</li>
          <li>Works on Windows, macOS, and Linux</li>
        </ul>

        <p style="margin-bottom: 32px;">
          <a href="https://leassh.com/setup" style="display: inline-block; background: #d4a24c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Start your 14-day free trial</a>
        </p>

        <p>Questions? Just reply to this email.</p>

        <p>Best,<br>
        Carl-Gustav<br>
        <span style="color: #666;">Founder, Leassh</span></p>

        <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 14px;">You can unsubscribe anytime by replying with "unsubscribe".</p>
      </div>`
    });

    res.status(200).json({
      success: true,
      message: 'Successfully subscribed! Check your email for a welcome message.'
    });

  } catch (error) {
    console.error('Newsletter subscription error:', error);
    res.status(500).json({ error: 'Something went wrong on our end. Please try again in a few minutes.' });
  }
};