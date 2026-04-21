/* ═══════════════════════════════════════════════════════════
   MODULE 6 — APPEL API GOOGLE GEMINI
   Commune de Sainte-Ode · v2.1
   ═══════════════════════════════════════════════════════════

   INSTRUCTIONS :
   Remplacez VOTRE_CLE_ICI par votre clé API Google Gemini
   (celle qui commence par AIza...)
   Ne partagez jamais cette clé publiquement.

   ⚠️  RAPPEL SÉCURITÉ : cette clé est visible côté navigateur.
   Prévoir un backend proxy pour la production.

   ═══════════════════════════════════════════════════════════ */

const API_KEY = "AIzaSyATvJpbqgXxAxnLJgx9m3Sq6aoZHMEe4a0";

const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
  API_KEY;

/* ── Constantes ── */
const HISTORY_MAX    = 20;   // nombre maximum de messages conservés
const FETCH_TIMEOUT  = 10000; // timeout fetch en millisecondes (10 s)
const MAX_TOKENS     = 800;   // augmenté de 600 → 800 pour éviter les réponses tronquées

/* ── Messages d'erreur multilingues ── */
const MSG_ERREUR = {
  fr: "Désolé, je n'ai pas pu traiter votre demande. Contactez-nous au **+32 61 21 04 40**.",
  nl: "Sorry, uw verzoek kon niet worden verwerkt. Bel ons op **+32 61 21 04 40**.",
  en: "Sorry, your request could not be processed. Contact us at **+32 61 21 04 40**.",
  de: "Entschuldigung, Ihre Anfrage konnte nicht bearbeitet werden. Rufen Sie uns an: **+32 61 21 04 40**.",
  ar: "عذراً، لم نتمكن من معالجة طلبك. اتصل بنا على **+32 61 21 04 40**."
};

const MSG_CONNEXION = {
  fr: "⚠️ Connexion indisponible. Contactez-nous au **+32 61 21 04 40** ou via [le guichet citoyen](https://sainteode.guichet-citoyen.be/).",
  nl: "⚠️ Verbinding niet beschikbaar. Bel **+32 61 21 04 40** of via [het burgerloket](https://sainteode.guichet-citoyen.be/).",
  en: "⚠️ Connection unavailable. Contact us at **+32 61 21 04 40** or via [citizen portal](https://sainteode.guichet-citoyen.be/).",
  de: "⚠️ Verbindung nicht verfügbar. Rufen Sie uns an: **+32 61 21 04 40** oder [Bürgerportal](https://sainteode.guichet-citoyen.be/).",
  ar: "⚠️ الاتصال غير متاح. اتصل بنا على **+32 61 21 04 40** أو عبر [بوابة المواطن](https://sainteode.guichet-citoyen.be/)."
};

const MSG_QUOTA = {
  fr: "⚠️ Le service est temporairement saturé. Réessayez dans quelques instants ou appelez-nous au **+32 61 21 04 40**.",
  nl: "⚠️ De service is tijdelijk overbelast. Probeer het later opnieuw of bel **+32 61 21 04 40**.",
  en: "⚠️ The service is temporarily overloaded. Please try again shortly or call **+32 61 21 04 40**.",
  de: "⚠️ Der Dienst ist vorübergehend überlastet. Versuchen Sie es später oder rufen Sie **+32 61 21 04 40** an.",
  ar: "⚠️ الخدمة مثقلة مؤقتاً. يرجى المحاولة مرة أخرى أو الاتصال على **+32 61 21 04 40**."
};

const MSG_TIMEOUT = {
  fr: "⚠️ La réponse prend trop de temps. Vérifiez votre connexion ou contactez-nous au **+32 61 21 04 40**.",
  nl: "⚠️ Het antwoord duurt te lang. Controleer uw verbinding of bel **+32 61 21 04 40**.",
  en: "⚠️ The response is taking too long. Check your connection or contact us at **+32 61 21 04 40**.",
  de: "⚠️ Die Antwort dauert zu lange. Überprüfen Sie Ihre Verbindung oder rufen Sie **+32 61 21 04 40** an.",
  ar: "⚠️ الاستجابة تستغرق وقتاً طويلاً. تحقق من اتصالك أو اتصل على **+32 61 21 04 40**."
};

/* ── Historique de la conversation ── */
/* FIX : persistance via sessionStorage — l'historique survit aux rechargements de page */
let history = [];
let loading  = false;

function loadHistory() {
  try {
    const stored = sessionStorage.getItem("chatHistory");
    if (stored) history = JSON.parse(stored);
  } catch (e) {
    history = [];
  }
}

function saveHistory() {
  try {
    sessionStorage.setItem("chatHistory", JSON.stringify(history));
  } catch (e) {
    /* sessionStorage plein ou indisponible — on continue sans persistance */
  }
}

/* ── Helpers sécurisés ── */

/* FIX : lecture sécurisée de window.lang avec fallback "fr" */
function getLang() {
  return (typeof window.lang === "string" && window.lang) ? window.lang : "fr";
}

/* FIX : lecture sécurisée de window.selectedSvc avec fallback null */
function getSelectedSvc() {
  return (typeof window.selectedSvc !== "undefined") ? window.selectedSvc : null;
}

/* FIX : appel sécurisé de getQR() — la fonction peut ne pas être définie */
function safeGetQR() {
  if (typeof getQR === "function") {
    try { return getQR(); } catch (e) { return undefined; }
  }
  return undefined;
}

/* ── Appel principal à l'API ── */
async function callGemini(userMessage) {
  loading = true;
  document.getElementById("send-btn").disabled = true;

  const lang = getLang();

  /* FIX : push d'abord, troncature ensuite */
  history.push({ role: "user", parts: [{ text: userMessage }] });
  if (history.length > HISTORY_MAX) {
    history = history.slice(-HISTORY_MAX);
  }
  saveHistory();

  showTyping();

  /* FIX : AbortController pour le timeout */
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildPrompt(getSelectedSvc(), lang) }]
        },
        contents: history,
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          temperature: 0.4
        }
      })
    });

    clearTimeout(timeoutId);

    /* FIX : vérification du statut HTTP avant de parser */
    if (!response.ok) {
      if (response.status === 429) {
        /* Quota API dépassé */
        hideTyping();
        addMsg("bot", MSG_QUOTA[lang]);
        _finaliseCall(lang);
        return;
      }
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      MSG_ERREUR[lang];

    history.push({ role: "model", parts: [{ text: reply }] });
    saveHistory();

    hideTyping();
    addMsg("bot", reply, safeGetQR());

  } catch (error) {
    clearTimeout(timeoutId);
    hideTyping();

    /* FIX : différencier timeout réseau et erreur générale */
    if (error.name === "AbortError") {
      addMsg("bot", MSG_TIMEOUT[lang]);
    } else {
      addMsg("bot", MSG_CONNEXION[lang]);
    }
  }

  _finaliseCall(lang);
}

/* ── Finalisation commune (réactivation UI) ── */
function _finaliseCall(lang) {
  loading = false;
  const btn   = document.getElementById("send-btn");
  const input = document.getElementById("chat-input");
  if (btn)   btn.disabled   = false;
  if (input) input.focus();
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
  addMsg("user", message);
  await callGemini(message);
}

function sendMessage() { sendMsg(); }

/* ── Réinitialisation du chat ── */
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
    addMsg("bot", s.welcome);
    setTimeout(showSvcSelector, 350);
  }, 300);
}

/* ── Initialisation : chargement de l'historique au démarrage ── */
loadHistory();
