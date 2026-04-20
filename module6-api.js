/* ═══════════════════════════════════════════════════════════
   MODULE 6 — APPEL API GOOGLE GEMINI
   Commune de Sainte-Ode · v2.0
   ═══════════════════════════════════════════════════════════

   INSTRUCTIONS :
   Remplacez VOTRE_CLE_ICI par votre clé API Google Gemini
   (celle qui commence par AIza...)
   Ne partagez jamais cette clé publiquement.

   ═══════════════════════════════════════════════════════════ */

const API_KEY = "AIzaSyDy7EuzqIMQ0qMggfQ3ohttn5R7yEuBvyE";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY;

/* Historique de la conversation (limité à 20 messages) */
let history = [];
let loading = false;

/* Messages d'erreur multilingues */
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

/* ── Appel principal à l'API ── */
async function callGemini(userMessage) {
  loading = true;
  document.getElementById("send-btn").disabled = true;

  if (history.length > 20) {
    history = history.slice(-20);
  }

  history.push({
    role: "user",
    parts: [{ text: userMessage }]
  });

  showTyping();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildPrompt(window.selectedSvc, window.lang) }]
        },
        contents: history,
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.4
        }
      })
    });

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      MSG_ERREUR[window.lang || "fr"];

    history.push({
      role: "model",
      parts: [{ text: reply }]
    });

    hideTyping();
    addMsg("bot", reply, getQR());

  } catch (error) {
    hideTyping();
    addMsg("bot", MSG_CONNEXION[window.lang || "fr"]);
  }

  loading = false;
  document.getElementById("send-btn").disabled = false;
  document.getElementById("chat-input").focus();
}

async function sendMsg(text) {
  const input = document.getElementById("chat-input");
  const message = text !== undefined ? text : input.value.trim();
  if (!message || loading) return;
  if (text === undefined) {
    input.value = "";
    input.style.height = "auto";
  }
  addMsg("user", message);
  await callGemini(message);
}

function sendMessage() { sendMsg(); }

function resetChat() {
  history = [];
  window.selectedSvc = null;
  const area = document.getElementById("messages");
  const s = S[window.lang] || S.fr;
  area.innerHTML = '<div class="ts" id="ts-label">' + s.ts + '</div>';
  document.getElementById("svc-pill").classList.remove("on");
  document.getElementById("chat-input").placeholder = s.ph;
  setTimeout(function() {
    addMsg("bot", s.welcome);
    setTimeout(showSvcSelector, 350);
  }, 300);
}
