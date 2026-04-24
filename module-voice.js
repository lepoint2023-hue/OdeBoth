/* ═══════════════════════════════════════════════════════════
   MODULE VOCAL — Ode · v2.0
   STT : Web Speech API (reconnaissance vocale navigateur)
   TTS : Web Speech Synthesis (voix navigateur/OS)
         Sélection automatique de la meilleure voix féminine
         disponible — aucun appel serveur, aucun quota.
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── Langue STT par code langue ─────────────────────────── */
const STT_LANG = {
  fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB',
  de: 'de-DE', es: 'es-ES', ar: 'ar-SA',
};

/* ── Voix préférées par langue (ordre de priorité) ──────────
   On cherche d'abord ces noms exacts, puis toute voix féminine
   dans la langue, puis n'importe quelle voix dans la langue.   */
const PREFERRED_VOICES = {
  fr: ['Google français',          'Amélie',   'Marie',    'Audrey',   'Virginie' ],
  nl: ['Google Nederlands',        'Ellen',    'Xander'                            ],
  en: ['Google UK English Female', 'Samantha', 'Karen',    'Moira',    'Serena'   ],
  de: ['Google Deutsch',           'Anna',     'Petra'                             ],
  es: ['Google español',           'Monica',   'Paulina'                           ],
  ar: ['Google العربية',           'Maged'                                         ],
};

/* Mots-clés qui signalent une voix féminine dans son nom */
const FEMALE_HINTS = [
  'female','femme','woman',
  'amélie','marie','audrey','virginie',
  'karen','samantha','moira','serena','hazel','susan','victoria',
  'anna','petra','anna',
  'monica','paulina',
  'ellen','denise','zira','allison','ava',
];

/* ── Labels UI multilingues ──────────────────────────────── */
const VLABELS = {
  idle:      { fr:'Appuyez pour parler',           nl:'Druk om te spreken',              en:'Press to speak',               de:'Drücken zum Sprechen',          es:'Presione para hablar',       ar:'اضغط للتحدث'         },
  listening: { fr:'Je vous écoute…',               nl:'Ik luister…',                     en:"I'm listening…",               de:'Ich höre zu…',                  es:'Le escucho…',                ar:'أستمع إليك…'          },
  thinking:  { fr:'Je réfléchis…',                 nl:'Ik denk na…',                     en:'Thinking…',                    de:'Ich denke…',                    es:'Pensando…',                  ar:'أفكر…'                },
  speaking:  { fr:'Je vous réponds…',              nl:'Ik antwoord…',                    en:'Speaking…',                    de:'Ich spreche…',                  es:'Respondiendo…',              ar:'أتحدث…'               },
  error_stt: { fr:'Micro non disponible',          nl:'Microfoon niet beschikbaar',      en:'Microphone unavailable',       de:'Mikrofon nicht verfügbar',      es:'Micrófono no disponible',    ar:'الميكروفون غير متاح'  },
  unavail:   { fr:'Voix non dispo sur cet appareil', nl:'Stem niet beschikbaar',         en:'Voice not available',          de:'Stimme nicht verfügbar',        es:'Voz no disponible',          ar:'الصوت غير متاح'       },
};

/* ── Cache voix sélectionnées par langue ─────────────────── */
const _voiceCache = {};

/* ── État interne ────────────────────────────────────────── */
let _voiceOpen   = false;
let _recognition = null;
let _voiceState  = 'idle';
let _loopEnabled = false;
let _speaking    = false;

/* ── Helpers ─────────────────────────────────────────────── */
function _lang() { return (typeof lang === 'string' && lang) ? lang : 'fr'; }

function _label(key) {
  const l = _lang();
  return (VLABELS[key] || VLABELS.idle)[l] || (VLABELS[key] || VLABELS.idle).fr;
}

/* Supprime le markdown et les URLs avant lecture à voix haute */
function _plain(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g,          '$1')
    .replace(/\*(.*?)\*/g,               '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s<"]+/g,    '')
    .replace(/<[^>]+>/g,                ' ')
    .replace(/^[-•]\s/gm,              '')
    .replace(/#{1,6}\s/g,              '')
    // ✅ Suppression des emojis et symboles pictographiques (pas lus à voix haute)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')  // emojis étendus (🚨🏥🌿💶 etc.)
    .replace(/[\u{2600}-\u{27BF}]/gu,   '')  // symboles divers (⚠️⚡⚰️ etc.)
    .replace(/[\u{2300}-\u{23FF}]/gu,   '')  // symboles techniques
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')  // tuiles mahjong
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')  // cartes à jouer
    .replace(/\uFE0F/gu,                '')  // sélecteur de variation emoji
    .replace(/\u200D/gu,                '')  // zero-width joiner
    .replace(/\n{2,}/g,                '. ')
    .replace(/\n/g,                    ' ')
    .replace(/\s{2,}/g,                ' ')
    .trim();
}\s/g,               '')
    .replace(/\n{2,}/g,                 '. ')
    .replace(/\n/g,                     ' ')
    .replace(/\s{2,}/g,                 ' ')
    .trim();
}

function _isFemale(voice) {
  const n = (voice.name + ' ' + voice.voiceURI).toLowerCase();
  return FEMALE_HINTS.some(h => n.includes(h));
}

/* ── Sélection automatique de la meilleure voix féminine ─── */
function _pickVoice(l) {
  if (_voiceCache[l]) return _voiceCache[l];

  const all    = window.speechSynthesis.getVoices();
  if (!all.length) return null;

  const inLang = all.filter(v => v.lang.toLowerCase().startsWith(l.toLowerCase()));
  if (!inLang.length) { _voiceCache[l] = all[0]; return all[0]; }

  /* 1. Voix préférée par nom */
  const preferred = PREFERRED_VOICES[l] || [];
  for (const name of preferred) {
    const hit = inLang.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
    if (hit) { _voiceCache[l] = hit; return hit; }
  }

  /* 2. Première voix féminine dans la langue */
  const female = inLang.find(v => _isFemale(v));
  if (female) { _voiceCache[l] = female; return female; }

  /* 3. Première voix dispo dans la langue */
  _voiceCache[l] = inLang[0];
  return inLang[0];
}

/* Les voix peuvent ne pas être dispo immédiatement au chargement */
function _ensureVoices(cb) {
  if (window.speechSynthesis.getVoices().length > 0) { cb(); return; }
  window.speechSynthesis.addEventListener('voiceschanged', function once() {
    window.speechSynthesis.removeEventListener('voiceschanged', once);
    cb();
  });
}

/* ── UI — état de l'orbe + label ─────────────────────────── */
function _setState(state) {
  _voiceState = state;
  const orb    = document.getElementById('voice-orb');
  const status = document.getElementById('voice-status');
  const micBtn = document.getElementById('voice-mic-btn');
  if (!orb || !status) return;
  orb.className    = 'voice-orb'    + (state !== 'idle' ? ' ' + state : '');
  status.className = 'voice-status' + (state !== 'idle' ? ' ' + state : '');
  status.textContent = _label(state);
  if (micBtn) micBtn.className = 'voice-mic-btn' + (state === 'listening' ? ' listening' : '');
}

function _addTranscript(role, text) {
  const box = document.getElementById('voice-transcript');
  if (!box) return;
  const div = document.createElement('div');
  div.className = role === 'user' ? 'vt-user' : 'vt-bot';

  if (role === 'bot') {
    /* ✅ Numéros belges cliquables — fixes ET mobiles (+32 4XX XX XX XX) */
    let safe = text.length > 300 ? text.slice(0, 297) + '…' : text;
    /* Échapper d'abord le HTML */
    safe = safe.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    /* Numéros : +32 suivi de 2 ou 3 chiffres (fixe/mobile) puis groupes de 2 */
    safe = safe.replace(
      /(\+32[\s.\-\/]?\d{2,3}[\s.\-\/]?\d{2}[\s.\-\/]?\d{2}[\s.\-\/]?\d{2}|\b0\d{2,3}[\s.\-\/]?\d{2}[\s.\-\/]?\d{2}[\s.\-\/]?\d{2})/g,
      function(p) {
        var tel  = p.replace(/[\s.\-\/]/g, '');
        var intl = tel.startsWith('0') ? '+32' + tel.slice(1) : tel;
        return '<a href="tel:' + intl + '" style="color:#7dd3fc;text-decoration:underline;white-space:nowrap">' + p + '</a>';
      }
    );
    /* Emails */
    safe = safe.replace(
      /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,
      '<a href="mailto:$1" style="color:#7dd3fc;text-decoration:underline">$1</a>'
    );
    div.innerHTML = safe;
  } else {
    div.textContent = text.length > 200 ? text.slice(0, 197) + '…' : text;
  }

  box.appendChild(div);
  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
}

/* ════════════════════════════════════════════════════════════
   TTS — Web Speech Synthesis
   ════════════════════════════════════════════════════════════ */

function _stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  _speaking = false;
}

/* Bouton ■ dans la barre d'input */

function _splitSentences(text) {
  /* Découpe sur ponctuation de fin — sans lookbehind (compatible Firefox/Safari) */
  const raw = text.replace(/([.!?:—])\s+/g, '$1\n').split('\n');
  const chunks = [];
  let current = '';
  for (const part of raw) {
    const p = part.trim();
    if (!p) continue;
    if ((current + ' ' + p).length > 220 && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + ' ' + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function speakText(rawText) {
  if (!_voiceOpen) return;
  const clean = _plain(rawText);
  if (!clean) return;
  _stopSpeaking();

  _ensureVoices(() => {
    if (!window.speechSynthesis) { _setState('unavail'); return; }

    _setState('speaking');
    _speaking = true;

    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.classList.add('visible');

    const l      = _lang();
    const voice  = _pickVoice(l);
    const chunks = _splitSentences(clean);
    let   idx    = 0;

    function speakNext() {
      if (!_speaking || idx >= chunks.length) {
        _speaking = false;
        if (stopBtn) stopBtn.classList.remove('visible');
        _onSpeakEnd();
        return;
      }

      const utt  = new SpeechSynthesisUtterance(chunks[idx++]);
      utt.lang   = STT_LANG[l] || 'fr-BE';
      utt.rate   = 0.93;
      utt.pitch  = 1.08;
      utt.volume = 1.0;
      if (voice) utt.voice = voice;

      utt.onend = () => setTimeout(speakNext, 120);

      utt.onerror = (e) => {
        if (e.error === 'interrupted') return;
        console.warn('[Ode Voice] TTS chunk', idx, ':', e.error);
        setTimeout(speakNext, 200);
      };

      /* Workaround Chrome/Android : la synthèse se fige si la page est inactive.
         On utilise pause+resume uniquement si la synthèse est en cours et ne parle plus
         (détection par position), à intervalle long pour ne pas interrompre une phrase. */
      if (/Android|Chrome/i.test(navigator.userAgent)) {
        let lastCheck = Date.now();
        const ticker = setInterval(function() {
          if (!_speaking) { clearInterval(ticker); return; }
          /* Relancer seulement si synthèse paused/bloquée */
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          } else if (!window.speechSynthesis.speaking) {
            /* Synthèse s'est arrêtée sans déclencher onend — forcer la suite */
            clearInterval(ticker);
            setTimeout(speakNext, 100);
          }
        }, 5000);
        const origEnd = utt.onend;
        const origErr = utt.onerror;
        utt.onend   = function() { clearInterval(ticker); origEnd(); };
        utt.onerror = function(e) { clearInterval(ticker); origErr(e); };
      }

      window.speechSynthesis.speak(utt);
    }

    speakNext();
  });
}
function _onSpeakEnd() {
  if (_voiceOpen && _loopEnabled) {
    setTimeout(startListening, 500);
  } else {
    _setState('idle');
  }
}

function _stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  _speaking = false;
}

/* Bouton ■ dans la barre d'input */
function stopVoicePlayback() {
  _loopEnabled = false;
  _stopSpeaking();
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.classList.remove('visible');
  _setState('idle');
}

/* ════════════════════════════════════════════════════════════
   STT — Web Speech Recognition
   ════════════════════════════════════════════════════════════ */
function startListening() {
  if (!_voiceOpen) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _setState('error_stt'); return; }

  _stopSpeaking();
  if (_recognition) { try { _recognition.abort(); } catch (e) {} }

  const l = _lang();
  _recognition                 = new SR();
  _recognition.lang            = STT_LANG[l] || 'fr-BE';
  _recognition.continuous      = false;
  _recognition.interimResults  = false;
  _recognition.maxAlternatives = 1;

  _recognition.onstart = () => _setState('listening');

  _recognition.onresult = async (event) => {
    const transcript = event.results[0]?.[0]?.transcript?.trim();
    if (!transcript) { startListening(); return; }

    _addTranscript('user', transcript);
    _setState('thinking');
    _loopEnabled = true;

    if (typeof addMsg     === 'function') addMsg('user', transcript);
    if (typeof callGemini === 'function') await callGemini(transcript);
  };

  _recognition.onerror = (e) => {
    if (e.error === 'aborted')   return;
    if (e.error === 'no-speech') { if (_voiceOpen) startListening(); return; }
    console.warn('[Ode Voice] STT:', e.error);
    _setState('error_stt');
    setTimeout(() => { if (_voiceOpen) _setState('idle'); }, 2000);
  };

  _recognition.onend = () => {
    if (_voiceOpen && _voiceState === 'listening') setTimeout(startListening, 200);
  };

  _recognition.start();
}

function _stopListening() {
  if (_recognition) { try { _recognition.abort(); } catch (e) {} _recognition = null; }
}

/* ════════════════════════════════════════════════════════════
   OVERLAY — ouvrir / fermer
   ════════════════════════════════════════════════════════════ */
function openVoiceOverlay() {
  const overlay = document.getElementById('voice-overlay');
  if (!overlay) return;
  const box = document.getElementById('voice-transcript');
  if (box) box.innerHTML = '';
  _voiceOpen   = true;
  _loopEnabled = true;
  overlay.classList.add('open');
  _setState('idle');
  setTimeout(startListening, 350);
}

function closeVoiceOverlay() {
  _voiceOpen   = false;
  _loopEnabled = false;
  _stopListening();
  _stopSpeaking();
  _setState('idle');
  const overlay = document.getElementById('voice-overlay');
  if (overlay) overlay.classList.remove('open');
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.classList.remove('listening');
}

/* Bouton micro dans la barre d'input */
function toggleInlineMic() {
  if (_voiceOpen) { closeVoiceOverlay(); }
  else {
    openVoiceOverlay();
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.classList.add('listening');
  }
}

/* Bouton micro dans l'overlay */
function toggleVoiceMic() {
  if (_voiceState === 'listening') { _stopListening(); _setState('idle'); }
  else { startListening(); }
}

/* ════════════════════════════════════════════════════════════
   CONNEXION AU CHAT — MutationObserver sur #messages
   Déclenche speakText sur chaque nouveau message bot sans
   modifier addMsg (pas de risque de boucle infinie).
   ════════════════════════════════════════════════════════════ */
(function _watchMessages() {
  function attach() {
    const area = document.getElementById('messages');
    if (!area) { setTimeout(attach, 200); return; }

    new MutationObserver((mutations) => {
      if (!_voiceOpen) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList?.contains('msg-row') && !node.classList.contains('user')) {
            const bbl = node.querySelector('.bbl.bot');
            if (bbl) {
              const text = bbl.innerText || bbl.textContent || '';
              if (text.trim()) { _addTranscript('bot', text); speakText(text); }
            }
          }
        }
      }
    }).observe(area, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

/* ════════════════════════════════════════════════════════════
   EXPOSITION GLOBALE — résout "not defined" si index.html
   appelle ces fonctions avant le chargement du module
   ════════════════════════════════════════════════════════════ */

/* checkStatusOnLoad — appelée dans window.onload de index.html */
function checkStatusOnLoad() {
  if (typeof window.exhaustedUntil !== 'undefined' && Date.now() < window.exhaustedUntil) {
    if (typeof setStatus === 'function') setStatus('quota');
  }
}

/* Exposition sur window pour les onclick inline du HTML */
window.openVoiceOverlay  = openVoiceOverlay;
window.closeVoiceOverlay = closeVoiceOverlay;
window.toggleVoiceMic    = toggleVoiceMic;
window.toggleInlineMic   = toggleInlineMic;
window.stopVoicePlayback = stopVoicePlayback;
window.checkStatusOnLoad = checkStatusOnLoad;
