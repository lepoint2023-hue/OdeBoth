/* ═══════════════════════════════════════════════════════════
   MODULE 6 — APPEL VIA PROXY CLOUDFLARE
   Commune de Sainte-Ode · v8.0
   ═══════════════════════════════════════════════════════════ */

const PROXY_URL = "https://ode-proxy.michelmimichelmichel.workers.dev";

const HISTORY_MAX    = 10;
const FETCH_TIMEOUT  = 25000; // 25s — délai raisonnable
/* Tokens différents par provider :
   Groq free = 6000 tokens/min. Prompt ≈ 4000 tokens → max 600 tokens réponse
   Gemini free = 1M tokens/min → on peut monter à 1200 */
const MAX_TOKENS_GROQ   = 600;
const MAX_TOKENS_GEMINI = 1200;

let activeProvider = sessionStorage.getItem("ode_provider") || "groq";
let exhaustedUntil = 0; // jamais persisté — un rechargement repart toujours frais

/* Exposition sur window pour checkApiStatus() dans index.html */
Object.defineProperty(window, 'exhaustedUntil', { get: function(){ return exhaustedUntil; } });

/* ── Reset nocturne à 1h00 ── */
(function scheduleNightlyReset() {
  function msUntil1am() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(1, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }
  function doReset() {
    activeProvider = "groq";
    exhaustedUntil = 0;
    sessionStorage.removeItem("ode_provider");
    if (typeof setStatus === "function") setStatus("online");
    console.info("[Ode] Reset nocturne — retour sur Groq");
    scheduleNightlyReset();
  }
  setTimeout(doReset, msUntil1am());
})();

/* ── Messages multilingues ── */
const MSG_ERREUR = {
  fr: "Désolé, je n'ai pas pu traiter votre demande. Contactez-nous au **+32 61 21 04 40**.",
  nl: "Sorry, uw verzoek kon niet worden verwerkt. Bel ons op **+32 61 21 04 40**.",
  en: "Sorry, your request could not be processed. Contact us at **+32 61 21 04 40**.",
  de: "Entschuldigung, Ihre Anfrage konnte nicht bearbeitet werden. Rufen Sie uns an: **+32 61 21 04 40**.",
  es: "Lo sentimos, no pudimos procesar su solicitud. Contáctenos en **+32 61 21 04 40**.",
  ar: "عذراً، لم نتمكن من معالجة طلبك. اتصل بنا على **+32 61 21 04 40**."
};
const MSG_CONNEXION = {
  fr: "⚠️ Connexion indisponible. Contactez-nous au **+32 61 21 04 40** ou via [le guichet citoyen](https://sainteode.guichet-citoyen.be/).",
  nl: "⚠️ Verbinding niet beschikbaar. Bel **+32 61 21 04 40** of via [het burgerloket](https://sainteode.guichet-citoyen.be/).",
  en: "⚠️ Connection unavailable. Contact us at **+32 61 21 04 40** or via [citizen portal](https://sainteode.guichet-citoyen.be/).",
  de: "⚠️ Verbindung nicht verfügbar. Rufen Sie uns an: **+32 61 21 04 40** oder [Bürgerportal](https://sainteode.guichet-citoyen.be/).",
  es: "⚠️ Conexión no disponible. Contáctenos en **+32 61 21 04 40** o via [portal ciudadano](https://sainteode.guichet-citoyen.be/).",
  ar: "⚠️ الاتصال غير متاح. اتصل بنا على **+32 61 21 04 40** أو عبر [بوابة المواطن](https://sainteode.guichet-citoyen.be/)."
};
const MSG_QUOTA = {
  fr: "⚠️ Le service est temporairement saturé. Réessayez dans quelques instants ou appelez-nous au **+32 61 21 04 40**.",
  nl: "⚠️ De service is tijdelijk overbelast. Probeer het later opnieuw of bel **+32 61 21 04 40**.",
  en: "⚠️ The service is temporarily overloaded. Please try again shortly or call **+32 61 21 04 40**.",
  de: "⚠️ Der Dienst ist vorübergehend überlastet. Versuchen Sie es später oder rufen Sie **+32 61 21 04 40** an.",
  es: "⚠️ El servicio está temporalmente saturado. Inténtelo de nuevo o llame al **+32 61 21 04 40**.",
  ar: "⚠️ الخدمة مثقلة مؤقتاً. يرجى المحاولة مرة أخرى أو الاتصال على **+32 61 21 04 40**."
};
const MSG_TIMEOUT = {
  fr: "⚠️ La réponse prend trop de temps. Vérifiez votre connexion ou contactez-nous au **+32 61 21 04 40**.",
  nl: "⚠️ Het antwoord duurt te lang. Controleer uw verbinding of bel **+32 61 21 04 40**.",
  en: "⚠️ The response is taking too long. Check your connection or contact us at **+32 61 21 04 40**.",
  de: "⚠️ Die Antwort dauert zu lange. Überprüfen Sie Ihre Verbindung oder rufen Sie **+32 61 21 04 40** an.",
  es: "⚠️ La respuesta tarda demasiado. Verifique su conexión o contáctenos en **+32 61 21 04 40**.",
  ar: "⚠️ الاستجابة تستغرق وقتاً طويلاً. تحقق من اتصالك أو اتصل على **+32 61 21 04 40**."
};

/* ── Historique ── */
let history = [];
let loading  = false;

function loadHistory() {
  try {
    const stored = sessionStorage.getItem("chatHistory");
    if (stored) history = JSON.parse(stored);
  } catch (e) { history = []; }
}
function saveHistory() {
  try { sessionStorage.setItem("chatHistory", JSON.stringify(history)); }
  catch (e) {}
}

/* ── Helpers ── */
function getLang() {
  return (typeof window.lang === "string" && window.lang) ? window.lang : "fr";
}
function getSelectedSvc() {
  return (typeof window.selectedSvc !== "undefined") ? window.selectedSvc : null;
}
function safeGetQR() {
  if (typeof getQR === "function") {
    try { return getQR(); } catch (e) { return undefined; }
  }
  return undefined;
}

/* ── Extraction réponse selon provider ── */
function _extractReply(data, provider, lang) {
  if (provider === "groq") {
    return data?.choices?.[0]?.message?.content || MSG_ERREUR[lang];
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || MSG_ERREUR[lang];
}

/* ── Appel proxy ── */
async function _callProxy(provider, systemPrompt, msgs, signal) {
  const maxTokens = (provider === "groq") ? MAX_TOKENS_GROQ : MAX_TOKENS_GEMINI;
  return await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      provider:     provider,
      systemPrompt: systemPrompt,
      messages:     msgs,
      maxTokens:    maxTokens
    })
  });
}

/* ══════════════════════════════════════════════════════
   APPEL PRINCIPAL — logique simple et rapide
   Groq → 429 → Gemini → 429 → message erreur
   Aucune attente, aucun blocage persistant
   ══════════════════════════════════════════════════════ */
async function callGemini(userMessage) {
  /* Blocage court en mémoire (2 min max, effacé au rechargement) */
  if (Date.now() < exhaustedUntil) {
    _callAddMsg("bot", MSG_QUOTA[getLang()]);
    return;
  }

  loading = true;
  document.getElementById("send-btn").disabled = true;

  const lang         = getLang();
  const systemPrompt = buildPrompt(getSelectedSvc(), lang);

  history.push({ role: "user", content: userMessage });
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  saveHistory();

  showTyping();

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    let provider = activeProvider;
    let response;

    /* 1. Appel provider actif */
    response = await _callProxy(provider, systemPrompt, history, controller.signal);

    /* 2. Rate limit → basculer immédiatement sur l'autre provider (pas d'attente) */
    if (response.status === 429) {
      const next = (provider === "groq") ? "gemini" : "groq";
      console.info("[Ode] " + provider + " rate-limit → bascule " + next);
      activeProvider = next;
      provider       = next;
      sessionStorage.setItem("ode_provider", next);
      response       = await _callProxy(provider, systemPrompt, history, controller.signal);
    }

    /* 3. Les deux saturés → blocage mémoire 90 secondes (pas sessionStorage) */
    if (response && response.status === 429) {
      exhaustedUntil = Date.now() + 90 * 1000; // 90s en mémoire seulement
      activeProvider = "groq";
      sessionStorage.removeItem("ode_provider");
      hideTyping();
      if (typeof setStatus === "function") setStatus("quota");
      _callAddMsg("bot", MSG_QUOTA[lang]);
      _finaliseCall();
      clearTimeout(timeoutId);
      return;
    }

    if (!response.ok) throw new Error("HTTP " + response.status);

    clearTimeout(timeoutId);

    const data  = await response.json();
    const reply = _extractReply(data, provider, lang);

    history.push({ role: "assistant", content: reply });
    saveHistory();

    hideTyping();
    if (typeof setStatus === "function") setStatus("online");
    _callAddMsg("bot", reply, safeGetQR());

  } catch (error) {
    clearTimeout(timeoutId);
    hideTyping();
    const isTimeout = error.name === "AbortError";
    if (typeof setStatus === "function") setStatus("offline");
    _callAddMsg("bot", isTimeout ? MSG_TIMEOUT[lang] : MSG_CONNEXION[lang]);
  }

  _finaliseCall();
}

/* ── Finalisation ── */
function _finaliseCall() {
  loading = false;
  const btn   = document.getElementById("send-btn");
  const input = document.getElementById("chat-input");
  if (btn)   btn.disabled   = false;
  if (input) input.focus();
}

/* ── Résolution tardive de addMsg ── */
function _callAddMsg(role, text, qrs) {
  if (typeof window.addMsg === "function") {
    window.addMsg(role, text, qrs);
  } else {
    setTimeout(function() { _callAddMsg(role, text, qrs); }, 100);
  }
}

/* ── Envoi d'un message ── */
async function sendMsg(text) {
  const input   = document.getElementById("chat-input");
  const message = text !== undefined ? text : input.value.trim();
  if (!message || loading) return;
  if (text === undefined) {
    input.value        = "";
    input.style.height = "auto";
  }
  _callAddMsg("user", message);
  await callGemini(message);
}

function sendMessage() { sendMsg(); }

/* ── Réinitialisation ── */
function resetChat() {
  history = [];
  sessionStorage.removeItem("chatHistory");
  window.selectedSvc = null;

  const area = document.getElementById("messages");
  const s    = S[getLang()] || S.fr;

  area.innerHTML = '<div class="ts" id="ts-label">' + s.ts + "</div>";
  document.getElementById("svc-pill").classList.remove("on");
  document.getElementById("chat-input").placeholder = s.ph;

  setTimeout(function () {
    _callAddMsg("bot", s.welcome);
    setTimeout(showSvcSelector, 2500);
  }, 300);
}

loadHistory();
