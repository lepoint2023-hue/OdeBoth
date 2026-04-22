/* ═══════════════════════════════════════════════════════════
   MODULE 6 — APPEL API GROQ + GEMINI (fallback)
   Commune de Sainte-Ode · v4.0
   ═══════════════════════════════════════════════════════════

   Remplacez les clés ci-dessous :
   - GROQ_KEY  : commence par gsk_...   (https://console.groq.com)
   - GEMINI_KEY: commence par AIza...   (https://aistudio.google.com/app/apikey)

   Fonctionnement :
   1. Groq est appelé en priorité (rapide, gratuit)
   2. Si Groq est saturé (quota 429), Gemini prend automatiquement le relais
   3. L'utilisateur ne voit aucune différence

   ⚠️  Ces clés sont visibles côté navigateur.
   Prévoir un backend proxy pour la production.
   ═══════════════════════════════════════════════════════════ */

const GROQ_KEY   = "VOTRE_CLE_GROQ_ICI";   // gsk_...
const GEMINI_KEY = "VOTRE_CLE_GEMINI_ICI"; // AIza...

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

/* ── Constantes ── */
const HISTORY_MAX   = 20;
const FETCH_TIMEOUT = 15000;
const MAX_TOKENS    = 800;

/* ── Provider actif (mémorisé pendant la session) ── */
let activeProvider = "groq"; // bascule sur "gemini" si Groq est à court

/* ── Messages d'erreur multilingues ── */
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

/* ══════════════════════════════════════════════════════
   APPELS API — un par provider
   ══════════════════════════════════════════════════════ */

/* ── Appel Groq ── */
async function _callGroq(systemPrompt, msgs, signal) {
  return await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + GROQ_KEY
    },
    signal,
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
      max_tokens: MAX_TOKENS,
      temperature: 0.4
    })
  });
}

/* ── Appel Gemini ── */
async function _callGemini(systemPrompt, msgs, signal) {
  /* Convertir l'historique format OpenAI → format Gemini */
  const contents = msgs.map(function(m) {
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    };
  });
  return await fetch(GEMINI_URL + GEMINI_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: contents,
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.4 }
    })
  });
}

/* ── Extraction texte selon le provider ── */
async function _extractReply(response, provider, lang) {
  const data = await response.json();
  if (provider === "groq") {
    return data?.choices?.[0]?.message?.content || MSG_ERREUR[lang];
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || MSG_ERREUR[lang];
}

/* ══════════════════════════════════════════════════════
   APPEL PRINCIPAL — Groq en priorité, Gemini en fallback
   ══════════════════════════════════════════════════════ */
async function callGemini(userMessage) {
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
    let response;
    let provider = activeProvider;

    /* 1️⃣ Appel avec le provider actif */
    response = (provider === "groq")
      ? await _callGroq(systemPrompt, history, controller.signal)
      : await _callGemini(systemPrompt, history, controller.signal);

    /* 2️⃣ Groq saturé → basculer sur Gemini pour ce message et les suivants */
    if (response.status === 429 && provider === "groq") {
      console.info("[Ode] Groq quota atteint — bascule sur Gemini");
      activeProvider = "gemini";
      provider       = "gemini";
      response       = await _callGemini(systemPrompt, history, controller.signal);
    }

    /* 3️⃣ Gemini saturé aussi → on abandonne */
    if (response.status === 429) {
      hideTyping();
      addMsg("bot", MSG_QUOTA[lang]);
      _finaliseCall();
      clearTimeout(timeoutId);
      return;
    }

    if (!response.ok) throw new Error("HTTP " + response.status);

    clearTimeout(timeoutId);

    const reply = await _extractReply(response, provider, lang);

    history.push({ role: "assistant", content: reply });
    saveHistory();

    hideTyping();
    addMsg("bot", reply, safeGetQR());

  } catch (error) {
    clearTimeout(timeoutId);
    hideTyping();
    addMsg("bot", error.name === "AbortError" ? MSG_TIMEOUT[lang] : MSG_CONNEXION[lang]);
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
    addMsg("bot", s.welcome);
    setTimeout(showSvcSelector, 2500);
  }, 300);
}

loadHistory();
