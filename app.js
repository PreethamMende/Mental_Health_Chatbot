// ═══════════════════════════════════════════════════════════════════════
//  MindCare AI — app.js  (trimodal: face + voice + text)
// ═══════════════════════════════════════════════════════════════════════

const API = "http://127.0.0.1:8000";

// ── DOM refs ────────────────────────────────────────────────────────────
const chatWindow          = document.getElementById("chat-window");
const userInput           = document.getElementById("user-input");
const sendBtn             = document.getElementById("send-btn");
const micBtn              = document.getElementById("mic-btn");
const startBtn            = document.getElementById("start-analysis");
const stopBtn             = document.getElementById("stop-analysis");
const liveVideo           = document.getElementById("live-video");
const emotionDisplay      = document.getElementById("emotion-display");
const emotionBars         = document.getElementById("emotion-bars");
const voiceEmotionDisplay = document.getElementById("voice-emotion-display");
const voiceConfFill       = document.getElementById("voice-confidence-fill");
const voiceConfLabel      = document.getElementById("voice-confidence-label");
const voiceStatus         = document.getElementById("voice-status");
const voiceStatusText     = document.getElementById("voice-status-text");
const emergencyBtn        = document.querySelector(".emergency-btn");
const emergencyModal      = document.getElementById("emergency-modal");
const closeModal          = document.getElementById("close-modal");

// ── State ───────────────────────────────────────────────────────────────
let stream        = null;
let frameInterval = null;
let recognition   = null;
let micActive     = false;
let ttsEnabled    = true;

// ═══════════════════════════════════════════════════════════════════════
//  CAMERA — frame capture every 2 s
// ═══════════════════════════════════════════════════════════════════════

startBtn.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    liveVideo.srcObject = stream;
    startBtn.disabled = true;
    stopBtn.disabled  = false;

    frameInterval = setInterval(captureAndAnalyzeFrame, 2000);
    startContinuousAudioAnalysis();

    appendMessage("system", "📷 Camera started. I can now see and hear your emotions.");
  } catch (err) {
    console.error("Camera/mic access error:", err);
    appendMessage("system", "⚠️ Could not access camera or microphone. Please allow permissions.");
  }
});

stopBtn.addEventListener("click", () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  clearInterval(frameInterval);
  liveVideo.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  appendMessage("system", "📷 Camera stopped.");
});

async function captureAndAnalyzeFrame() {
  if (!stream) return;
  const canvas = document.createElement("canvas");
  canvas.width  = liveVideo.videoWidth  || 320;
  canvas.height = liveVideo.videoHeight || 240;
  canvas.getContext("2d").drawImage(liveVideo, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const fd = new FormData();
    fd.append("frame", blob, "frame.jpg");
    try {
      const res  = await fetch(`${API}/analyze_frame`, { method: "POST", body: fd });
      const data = await res.json();
      updateFaceEmotionUI(data.emotion, data.scores);
    } catch (e) { console.error("Frame analysis error:", e); }
  }, "image/jpeg", 0.8);
}

function updateFaceEmotionUI(emotion, scores) {
  if (!emotion) return;
  emotionDisplay.textContent = capitalize(emotion);
  emotionDisplay.className   = `emotion-label ${emotion}`;

  if (!scores || Object.keys(scores).length === 0) { emotionBars.innerHTML = ""; return; }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  emotionBars.innerHTML = sorted.map(([label, val]) => `
    <div class="bar-row">
      <span class="bar-label">${capitalize(label)}</span>
      <div class="bar-track">
        <div class="bar-fill ${label}" style="width:${(val * 100).toFixed(1)}%"></div>
      </div>
      <span class="bar-pct">${(val * 100).toFixed(0)}%</span>
    </div>`).join("");
}

// ═══════════════════════════════════════════════════════════════════════
//  CONTINUOUS AUDIO EMOTION — 5-second rolling chunks
// ═══════════════════════════════════════════════════════════════════════

function startContinuousAudioAnalysis() {
  if (!stream) return;
  const audioStream = new MediaStream(stream.getAudioTracks());
  scheduleAudioChunk(audioStream);
}

function scheduleAudioChunk(audioStream) {
  if (!stream) return;
  const chunks   = [];
  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    await sendAudioForAnalysis(blob);
    if (stream) setTimeout(() => scheduleAudioChunk(audioStream), 500);
  };

  recorder.start();
  setTimeout(() => { try { if (recorder.state === "recording") recorder.stop(); } catch(_){} }, 5000);
}

async function sendAudioForAnalysis(blob) {
  const fd = new FormData();
  fd.append("audio", blob, "audio.webm");
  try {
    const res  = await fetch(`${API}/analyze_audio`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.emotion) updateVoiceEmotionUI(data.emotion, data.confidence, data.scores);
  } catch (e) { console.error("Audio analysis error:", e); }
}

function updateVoiceEmotionUI(emotion, confidence, scores) {
  if (!emotion) return;
  voiceEmotionDisplay.textContent = capitalize(emotion);
  voiceEmotionDisplay.className   = `emotion-label ${emotion}`;
  const pct = Math.round((confidence || 0) * 100);
  voiceConfFill.style.width       = `${pct}%`;
  voiceConfLabel.textContent      = `${pct}%`;
}

// ═══════════════════════════════════════════════════════════════════════
//  MIC BUTTON — click once to START, click again to STOP & send
// ═══════════════════════════════════════════════════════════════════════

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title    = "Speech recognition not supported in this browser";
    micBtn.disabled = true;
    return;
  }

  recognition                = new SpeechRecognition();
  recognition.continuous     = true;    // keep listening until explicitly stopped
  recognition.interimResults = true;
  recognition.lang           = "en-US";

  recognition.onresult = (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    userInput.value = (final || interim).trim();
  };

  recognition.onend = () => {
    // Browser cut it off — restart if we're still supposed to be active
    if (micActive) {
      try { recognition.start(); } catch (_) {}
    } else {
      micBtn.textContent = "🎙️";
      micBtn.classList.remove("recording");
      setVoiceStatus(false);
    }
  };

  recognition.onerror = (e) => {
    if (e.error === "no-speech") return;
    console.warn("Speech recognition error:", e.error);
    micActive = false;
    micBtn.textContent = "🎙️";
    micBtn.classList.remove("recording");
    setVoiceStatus(false);
  };
}

// ── Single click toggles mic on / off ───────────────────────────────
micBtn.addEventListener("click", toggleMic);

function toggleMic() {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return;

  if (!micActive) {
    // START
    micActive = true;
    userInput.value = "";
    micBtn.textContent = "⏹️";
    micBtn.classList.add("recording");
    setVoiceStatus(true, "Listening… click ⏹️ again to send");
    try { recognition.start(); } catch (_) {}
  } else {
    // STOP → auto-send
    micActive = false;
    try { recognition.stop(); } catch (_) {}
    micBtn.textContent = "🎙️";
    micBtn.classList.remove("recording");
    setVoiceStatus(false);
    setTimeout(() => { if (userInput.value.trim()) sendMessage(); }, 350);
  }
}

function setVoiceStatus(active, text = "") {
  if (active) {
    voiceStatus.classList.remove("hidden");
    voiceStatusText.textContent = text;
  } else {
    voiceStatus.classList.add("hidden");
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  CHAT — send message
// ═══════════════════════════════════════════════════════════════════════

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  const typingId = appendMessage("bot", "…", true);

  try {
    const res  = await fetch(`${API}/analyze_text`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ text }),
    });
    const data = await res.json();
    removeMessage(typingId);
    appendMessage("bot", data.response);

    if (data.voice_emotion) updateVoiceEmotionUI(data.voice_emotion, data.voice_conf);
    if (ttsEnabled && data.response) speakReply(data.response);

  } catch (err) {
    removeMessage(typingId);
    appendMessage("bot", "⚠️ Could not reach the backend. Is the server running?");
    console.error("sendMessage error:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TEXT-TO-SPEECH
// ═══════════════════════════════════════════════════════════════════════

function speakReply(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.rate   = 0.92;
  utt.pitch  = 1.05;
  utt.volume = 1.0;
  const voices    = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.startsWith("en") && v.name.toLowerCase().includes("female"))
                 || voices.find(v => v.lang.startsWith("en"))
                 || null;
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}
window.speechSynthesis?.addEventListener("voiceschanged", () => {});

// ═══════════════════════════════════════════════════════════════════════
//  CHAT UI HELPERS
// ═══════════════════════════════════════════════════════════════════════

let msgCounter = 0;

function appendMessage(role, text, isTyping = false) {
  const id  = `msg-${++msgCounter}`;
  const div = document.createElement("div");
  div.id        = id;
  div.className = `message ${role}${isTyping ? " typing" : ""}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return id;
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════════════════
//  EMERGENCY MODAL
// ═══════════════════════════════════════════════════════════════════════

emergencyBtn.addEventListener("click", () => emergencyModal.style.display = "flex");
closeModal.addEventListener("click",   () => emergencyModal.style.display = "none");
window.addEventListener("click", e => {
  if (e.target === emergencyModal) emergencyModal.style.display = "none";
});

// ═══════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

// ── Init ──────────────────────────────────────────────────────────────
initSpeechRecognition();
appendMessage("system", "👋 Hello! I'm MindCare AI. Start the camera to enable full trimodal emotion sensing, or just type below. Click 🎙️ to speak.");
