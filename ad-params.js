/*
 * Anzeigen-Kennung (GCLID/GBRAID/WBRAID) und UTM-Werte aus der Adresse lesen.
 * Es wird nichts auf dem Gerät gespeichert (kein Cookie, kein localStorage).
 * Damit die Kennung beim Wechsel auf eine Unterseite erhalten bleibt,
 * wird sie an interne Links angehängt.
 * Das Formular übermittelt die Kennung nur zur Zuordnung der Anfrage;
 * an Google geht sie nur, wenn die Person im Formular zustimmt.
 */
(function () {
  var KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'];
  var SAFE = /^[A-Za-z0-9_\-.~ äöüÄÖÜß+]{1,200}$/;
  var params = {};
  try {
    var q = new URLSearchParams(window.location.search);
    KEYS.forEach(function (k) {
      var v = q.get(k);
      if (v && SAFE.test(v)) params[k] = v;
    });
  } catch (e) { /* alte Browser: einfach ohne Kennung */ }

  window.krauseAdParams = params;
  var hasAdId = !!(params.gclid || params.gbraid || params.wbraid);

  function init() {
    // Einwilligungs-Häkchen nur zeigen, wenn die Person über eine Anzeige kam
    var wrap = document.getElementById('ads-consent-wrap');
    if (wrap && hasAdId) wrap.hidden = false;

    // Kennung an interne Links anhängen
    if (!Object.keys(params).length) return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
      try {
        var u = new URL(href, window.location.href);
        if (u.host !== window.location.host) continue;
        KEYS.forEach(function (k) { if (params[k] && !u.searchParams.has(k)) u.searchParams.set(k, params[k]); });
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) { /* Link unverändert lassen */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
