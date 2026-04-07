#!/bin/bash

# Newsletter CSS styles to add
CSS_STYLES='
  /* Newsletter signup */
  .newsletter-signup {
    max-width: var(--prose);
    margin: 40px auto 0 auto;
    padding: 0 32px;
  }

  .newsletter-card {
    background: var(--bg-warm);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
  }

  .newsletter-title {
    font-family: var(--font-d);
    font-size: clamp(20px, 3vw, 28px);
    font-weight: 700;
    color: var(--text);
    margin-bottom: 12px;
    letter-spacing: -0.5px;
  }

  .newsletter-subtitle {
    color: var(--text-mid);
    font-size: 15px;
    margin-bottom: 24px;
    line-height: 1.6;
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .newsletter-form {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .newsletter-input {
    flex: 1;
    min-width: 240px;
    max-width: 300px;
    padding: 14px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-family: var(--font-b);
    font-size: 15px;
    transition: border-color 0.2s;
  }

  .newsletter-input:focus {
    outline: none;
    border-color: var(--amber);
  }

  .newsletter-input::placeholder {
    color: var(--text-dim);
  }

  .newsletter-btn {
    padding: 14px 24px;
    background: var(--amber);
    color: var(--bg);
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: transform 0.2s var(--ease), background 0.2s;
    font-family: var(--font-b);
    white-space: nowrap;
  }

  .newsletter-btn:hover {
    transform: translateY(-1px);
    background: var(--amber-soft);
  }

  .newsletter-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .newsletter-consent {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
    line-height: 1.4;
    justify-content: center;
    text-align: left;
    max-width: 400px;
    margin: 0 auto;
  }

  .newsletter-consent input[type="checkbox"] {
    margin-top: 2px;
    accent-color: var(--amber);
  }

  .newsletter-consent a {
    color: var(--amber-soft);
    text-decoration: none;
  }

  .newsletter-consent a:hover {
    color: var(--amber);
  }

  .newsletter-message {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    display: none;
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .newsletter-message.success {
    background: var(--green-bg);
    color: var(--green);
    border: 1px solid rgba(106, 191, 105, 0.2);
  }

  .newsletter-message.error {
    background: var(--red-bg);
    color: var(--red);
    border: 1px solid rgba(212, 91, 76, 0.2);
  }'

# Newsletter HTML form
HTML_FORM='
<div class="newsletter-signup">
  <div class="newsletter-card">
    <h3 class="newsletter-title">Get more parenting tech insights</h3>
    <p class="newsletter-subtitle">Weekly tips on digital wellness, screen time management, and understanding your child'\''s online world.</p>
    <form class="newsletter-form" id="blogNewsletterForm">
      <input
        type="email"
        class="newsletter-input"
        placeholder="Enter your email address"
        required
        id="blogNewsletterEmail"
      >
      <button type="submit" class="newsletter-btn" id="blogNewsletterBtn">Subscribe</button>
    </form>
    <div class="newsletter-consent">
      <input type="checkbox" id="blogGdprConsent" required>
      <label for="blogGdprConsent">
        I agree to receive email updates and understand I can unsubscribe anytime.
        Read our <a href="/privacy">privacy policy</a>.
      </label>
    </div>
    <div class="newsletter-message" id="blogNewsletterMessage"></div>
  </div>
</div>'

# JavaScript code
JS_CODE='
<script>
// Blog newsletter form handler
document.getElementById('\''blogNewsletterForm'\'').addEventListener('\''submit'\'', async (e) => {
  e.preventDefault();

  const email = document.getElementById('\''blogNewsletterEmail'\'').value;
  const gdprConsent = document.getElementById('\''blogGdprConsent'\'').checked;
  const btn = document.getElementById('\''blogNewsletterBtn'\'');
  const message = document.getElementById('\''blogNewsletterMessage'\'');

  if (!gdprConsent) {
    showBlogNewsletterMessage('\''Please agree to receive email updates'\'', '\''error'\'');
    return;
  }

  btn.disabled = true;
  btn.textContent = '\''Subscribing...'\'';
  message.style.display = '\''none'\'';

  try {
    const response = await fetch('\''/api/newsletter/subscribe'\'', {
      method: '\''POST'\'',
      headers: {
        '\''Content-Type'\'': '\''application/json'\'',
      },
      body: JSON.stringify({
        email: email,
        gdpr_consent: gdprConsent,
        source: '\''blog'\''
      }),
    });

    const data = await response.json();

    if (response.ok) {
      showBlogNewsletterMessage(data.message, '\''success'\'');
      document.getElementById('\''blogNewsletterForm'\'').reset();
      document.getElementById('\''blogGdprConsent'\'').checked = false;
    } else {
      showBlogNewsletterMessage(data.error || '\''Failed to subscribe'\'', '\''error'\'');
    }
  } catch (error) {
    showBlogNewsletterMessage('\''Network error. Please try again.'\'', '\''error'\'');
  } finally {
    btn.disabled = false;
    btn.textContent = '\''Subscribe'\'';
  }
});

function showBlogNewsletterMessage(text, type) {
  const message = document.getElementById('\''blogNewsletterMessage'\'');
  message.textContent = text;
  message.className = `newsletter-message ${type}`;
  message.style.display = '\''block'\'';

  if (type === '\''success'\'') {
    setTimeout(() => {
      message.style.display = '\''none'\'';
    }, 5000);
  }
}
</script>'

# List of blog files to update (excluding the one we already updated)
BLOG_FILES=(
  "blog-gaming-addiction.html"
  "blog-homelab-fleet-monitoring.html"
  "blog-homelab-gpu.html"
  "blog-monitor-child-without-spyware.html"
  "blog-parental-control-comparison-2026.html"
  "blog-screen-time-management.html"
  "blog-what-is-my-child-doing.html"
)

echo "Updating ${#BLOG_FILES[@]} blog posts with newsletter signup forms..."

for file in "${BLOG_FILES[@]}"; do
  echo "Processing $file..."

  # Check if file exists
  if [[ ! -f "$file" ]]; then
    echo "  Warning: $file not found, skipping..."
    continue
  fi

  # 1. Add CSS styles after btn-primary styles and before /* Footer */
  if grep -q "/* Newsletter signup */" "$file"; then
    echo "  Newsletter CSS already exists, skipping CSS update..."
  else
    sed -i '/\.btn-primary:hover.*box-shadow.*amber.*/ {
      a\
      '"$CSS_STYLES"'
      }' "$file"
    echo "  Added newsletter CSS styles"
  fi

  # 2. Add HTML form after </div> that closes post-cta and before <footer>
  if grep -q "newsletter-signup" "$file"; then
    echo "  Newsletter HTML already exists, skipping HTML update..."
  else
    sed -i '/<\/div>$/ {
      N
      /<\/div>\n*<footer>/ {
        i\
        '"$HTML_FORM"'
      }
    }' "$file"
    echo "  Added newsletter HTML form"
  fi

  # 3. Add JavaScript before closing body tag
  if grep -q "blogNewsletterForm" "$file"; then
    echo "  Newsletter JavaScript already exists, skipping JS update..."
  else
    sed -i '/<\/body>/ {
      i\
      '"$JS_CODE"'
    }' "$file"
    echo "  Added newsletter JavaScript"
  fi

  echo "  Completed $file"
done

echo "Newsletter signup forms added to all blog posts!"