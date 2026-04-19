
/* ═══════════════════════════════════════════════════════════
   MODULE 6 — APPEL API GOOGLE GEMINI
   Commune de Sainte-Ode · v1.0
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
 
/* ── Appel principal à l'API ── */
async function callGemini(userMessage) {
  loading = true;
  document.getElementById("send-btn").disabled = true;
 
  /* Limiter l'historique pour éviter les coûts excessifs */
  if (history.length > 20) {
    history = history.slice(-20);
  }
 
  /* Ajouter le message du citoyen à l'historique */
  history.push({
    role: "user",
    parts: [{ text: userMessage }]
  });
 
  /* Afficher l'animation "en train d'écrire..." */
  showTyping();
 
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        /* Instructions permanentes pour le bot */
        system_instruction: {
parts: [{ text: buildPrompt(window.selectedSvc, window.lang) }]
},
        /* Historique de la conversation */
        contents: history,
        /* Paramètres de génération */
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.4
        }
      })
    });
 
   const data = await response.json();
    /* Extraire la réponse du bot */
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Désolé, je n'ai pas pu traiter votre demande. Contactez-nous au **+32 61 21 04 40**.";
 
    /* Ajouter la réponse à l'historique */
    history.push({
      role: "model",
      parts: [{ text: reply }]
    });
 
    /* Afficher la réponse */
    hideTyping();
    addMsg("bot", reply, getQR());
 
  } catch (error) {
    hideTyping();
    addMsg(
      "bot",
      "⚠️ Connexion indisponible. Contactez-nous au **+32 61 21 04 40** ou via [le guichet citoyen](https://sainteode.guichet-citoyen.be/)."
    );
  }
 
  loading = false;
  document.getElementById("send-btn").disabled = false;
  document.getElementById("chat-input").focus();
}
 
/* ── Envoi d un message (depuis bouton ou touche Entrée) ── */
async function sendMsg(text) {
  const input = document.getElementById("chat-input");
  const message = text !== undefined ? text : input.value.trim();
 
  if (!message || loading) return;
 
  /* Vider le champ de saisie si message tapé manuellement */
  if (text === undefined) {
    input.value = "";
    input.style.height = "auto";
  }
 
  addMsg("user", message);
  await callGemini(message);
}
 
/* Alias pour compatibilité avec le bouton HTML */
function sendMessage() { sendMsg(); }
 
/* ── Réinitialiser la conversation ── */
function resetChat() {
  history = [];
  selectedSvc = null;
  const area = document.getElementById("messages");
  const s = S[lang] || S.fr;
  area.innerHTML = `<div class="ts" id="ts-label">${s.ts}</div>`;
  document.getElementById("svc-pill").classList.remove("on");
  document.getElementById("chat-input").placeholder = s.ph;
 
  setTimeout(() => {
    addMsg("bot", s.welcome);
    setTimeout(showSvcSelector, 350);
  }, 300);
}
