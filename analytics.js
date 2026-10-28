// Minimal first-party funnel tracking. No cookies, no third-party script.
// Events land in Supabase `funnel_events` via /api/events (204, best effort).
(function () {
  function track(event, props) {
    try {
      var payload = JSON.stringify({
        event: event,
        path: location.pathname,
        props: props || {},
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/events', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      // Analytics must never break the page.
    }
  }

  window.leasshTrack = track;

  document.addEventListener('DOMContentLoaded', function () {
    var path = location.pathname;
    if (path === '/pricing') track('pricing_view');
    if (path === '/platforms') track('platforms_view');
    if (path === '/account') track('account_view');

    document.addEventListener('click', function (ev) {
      var link = ev.target.closest ? ev.target.closest('a,button') : null;
      if (!link) return;
      var card = link.closest('[data-plan]');
      var plan = card ? card.getAttribute('data-plan') : null;
      if (link.matches('.cta-button, .btn') && (plan || /checkout|trial|start free/i.test(link.textContent))) {
        track('plan_cta_click', { plan: plan || 'unknown', label: (link.textContent || '').trim().slice(0, 60) });
      }
      if (link.tagName === 'A' && /families\.google\.com|support\.apple\.com/.test(link.href)) {
        track('companion_click', { target: /families\.google\.com/.test(link.href) ? 'family-link' : 'screen-time' });
      }
    });
  });
})();
