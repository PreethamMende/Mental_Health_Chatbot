from fastapi import FastAPI, Request, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import requests, io, tempfile, os, subprocess
import numpy as np
from PIL import Image
import cv2
from fer.fer import FER
import librosa

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://127.0.0.1:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral:latest")

# ── shared emotion state ────────────────────────────────────────────────
latest_face_emotion  = {"emotion": None, "scores": {}}
latest_voice_emotion = {"emotion": None, "confidence": 0.0, "scores": {}}

# ── FER detector ────────────────────────────────────────────────────────
detector = FER(mtcnn=True)

NEGATIVE_EMOTIONS = {"sad", "angry", "fearful", "disgusted"}

# ── Speech Emotion Recognition via transformers (wav2vec2) ──────────────
# Uses: superb/wav2vec2-base-superb-er  — fine-tuned on IEMOCAP
# Labels: neu, hap, ang, sad  (maps to our 7-class scheme)
_ser_pipeline = None

def get_ser_pipeline():
    global _ser_pipeline
    if _ser_pipeline is None:
        try:
            from transformers import pipeline
            _ser_pipeline = pipeline(
                "audio-classification",
                model="superb/wav2vec2-base-superb-er",
                device=-1,          # CPU (works on all Macs)
            )
            print("✅ SER model loaded (superb/wav2vec2-base-superb-er)")
        except Exception as e:
            print(f"⚠️  Could not load SER model: {e}")
            _ser_pipeline = None
    return _ser_pipeline

# Map model output labels → our UI labels
LABEL_MAP = {
    "neu": "neutral",
    "hap": "happy",
    "ang": "angry",
    "sad": "sad",
    "exc": "happy",    # excited → happy
    "fru": "disgusted",# frustrated → disgusted
    "fea": "fearful",
    "dis": "disgusted",
    "sur": "surprised",
    # some models use full words
    "neutral":   "neutral",
    "happy":     "happy",
    "angry":     "angry",
    "sad":       "sad",
    "fearful":   "fearful",
    "disgusted": "disgusted",
    "surprised": "surprised",
    "calm":      "neutral",
}

def predict_speech_emotion_wav2vec(audio_array: np.ndarray, sr: int):
    """
    Use wav2vec2-based SER pipeline.
    Returns (emotion_label, confidence, scores_dict).
    """
    pipe = get_ser_pipeline()
    if pipe is None:
        return fallback_ser(audio_array, sr)

    try:
        # pipeline expects 16 kHz mono float32
        if sr != 16000:
            audio_array = librosa.resample(audio_array, orig_sr=sr, target_sr=16000)
        results = pipe({"array": audio_array.astype(np.float32), "sampling_rate": 16000},
                       top_k=None)
        scores = {LABEL_MAP.get(r["label"], r["label"]): round(r["score"], 4) for r in results}
        # merge duplicates (e.g. exc+hap both → happy)
        merged = {}
        for k, v in scores.items():
            merged[k] = merged.get(k, 0) + v
        top = max(merged.items(), key=lambda x: x[1])
        return top[0], round(top[1], 4), merged
    except Exception as e:
        print("SER pipeline error:", e)
        return fallback_ser(audio_array, sr)


def fallback_ser(y: np.ndarray, sr: int):
    """
    MFCC heuristic fallback when wav2vec2 is unavailable.
    Returns (emotion, confidence, scores_dict).
    """
    mfcc   = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    energy = float(np.mean(librosa.feature.rms(y=y)))
    zcr    = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
    pitch  = 0.0
    try:
        pitches, mags = librosa.piptrack(y=y, sr=sr)
        vals = pitches[mags > 0]
        if len(vals): pitch = float(np.mean(vals))
    except: pass

    mfcc1 = float(np.mean(mfcc[0]))
    mfcc2 = float(np.mean(mfcc[1]))

    scores = {"neutral": 0.15, "happy": 0.10, "sad": 0.10,
              "angry": 0.10, "fearful": 0.10, "disgusted": 0.10, "surprised": 0.10}

    if energy > 0.06 and zcr > 0.12:
        scores["angry"]   += 0.55
    elif energy > 0.04 and pitch > 180:
        scores["happy"]   += 0.50
    elif energy > 0.04 and zcr <= 0.10:
        scores["surprised"] += 0.45
    elif energy < 0.02 and mfcc1 < -150:
        scores["sad"]     += 0.55
    elif energy < 0.01:
        scores["fearful"] += 0.45
    else:
        scores["neutral"] += 0.45

    total = sum(scores.values())
    scores = {k: round(v / total, 4) for k, v in scores.items()}
    top    = max(scores.items(), key=lambda x: x[1])
    return top[0], top[1], scores


# ════════════════════════════════════════════════════════════════════════
#  ROUTES
# ════════════════════════════════════════════════════════════════════════

@app.get("/")
async def home():
    return {"message": "MindCare AI Backend is running successfully 🌿"}


@app.post("/analyze_frame")
async def analyze_frame(frame: UploadFile = File(...)):
    try:
        contents = await frame.read()
        pil_img  = Image.open(io.BytesIO(contents)).convert("RGB")
        img      = np.array(pil_img)
        results  = detector.detect_emotions(img)

        if not results:
            latest_face_emotion.update({"emotion": "neutral", "scores": {}})
            return {"emotion": "neutral", "scores": {}}

        best        = max(results, key=lambda r: r["box"][2] * r["box"][3])
        scores      = best.get("emotions", {})
        top_emotion = max(scores.items(), key=lambda kv: kv[1])[0] if scores else "neutral"

        latest_face_emotion.update({"emotion": top_emotion, "scores": scores})
        return {"emotion": top_emotion, "scores": scores}

    except Exception as e:
        print("Error in /analyze_frame:", e)
        latest_face_emotion.update({"emotion": None, "scores": {}})
        return {"emotion": None, "scores": {}}


@app.post("/analyze_audio")
async def analyze_audio(audio: UploadFile = File(...)):
    try:
        contents = await audio.read()

        # Write to temp file; ffmpeg will handle .webm decoding via librosa
        suffix = ".webm" if (audio.content_type and "webm" in audio.content_type) else ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        try:
            y, sr = librosa.load(tmp_path, sr=16000, mono=True)
        finally:
            try: os.unlink(tmp_path)
            except: pass

        if len(y) < sr * 0.5:
            return {"emotion": "neutral", "confidence": 0.5, "scores": {}}

        emotion, confidence, scores = predict_speech_emotion_wav2vec(y, sr)

        latest_voice_emotion.update({
            "emotion":    emotion,
            "confidence": confidence,
            "scores":     scores,
        })
        return {"emotion": emotion, "confidence": confidence, "scores": scores}

    except Exception as e:
        print("Error in /analyze_audio:", e)
        return {"emotion": None, "confidence": 0.0, "scores": {}}


@app.post("/analyze_text")
async def analyze_text(request: Request):
    try:
        data      = await request.json()
        user_text = data.get("text", "")

        face_emotion  = latest_face_emotion.get("emotion")
        face_scores   = latest_face_emotion.get("scores", {})
        voice_emotion = latest_voice_emotion.get("emotion")
        voice_conf    = latest_voice_emotion.get("confidence", 0.0)
        voice_scores  = latest_voice_emotion.get("scores", {})

        # ── mismatch detection ──────────────────────────────────────────
        positive_words = {"fine","good","great","okay","ok","happy",
                          "well","alright","better","fantastic","wonderful","amazing"}
        text_positive  = any(w in user_text.lower() for w in positive_words)
        face_neg       = face_emotion  in NEGATIVE_EMOTIONS if face_emotion  else False
        voice_neg      = voice_emotion in NEGATIVE_EMOTIONS if voice_emotion else False
        mismatch       = text_positive and (face_neg or voice_neg)

        # ── build prompt ────────────────────────────────────────────────
        system_prompt = (
            "You are MindCare AI, a compassionate emotionally intelligent mental health companion. "
            "Keep responses short (2-4 sentences), warm, supportive, and conversational. "
            "Never give medical diagnoses or prescriptions. "
            "Use empathetic, non-judgmental language."
        )

        face_ctx = f"Face  emotion : {face_emotion}" if face_emotion else "Face  emotion : unknown"
        if face_scores:
            top3 = sorted(face_scores.items(), key=lambda kv: kv[1], reverse=True)[:3]
            face_ctx += "  (" + ", ".join(f"{k}:{v:.2f}" for k, v in top3) + ")"

        voice_ctx = (f"Voice emotion : {voice_emotion} (conf {voice_conf:.0%})"
                     if voice_emotion else "Voice emotion : unknown")
        if voice_scores:
            top3v = sorted(voice_scores.items(), key=lambda kv: kv[1], reverse=True)[:3]
            voice_ctx += "  (" + ", ".join(f"{k}:{v:.2f}" for k, v in top3v) + ")"

        mismatch_note = (
            "\n⚠️  MISMATCH: User's words are positive but face/voice show distress. "
            "Gently surface this without being confrontational."
            if mismatch else ""
        )

        full_prompt = (
            f"{system_prompt}\n\n"
            f"Emotional context:\n  {face_ctx}\n  {voice_ctx}"
            f"{mismatch_note}\n\n"
            f"User: {user_text}\nAssistant:"
        )

        resp = requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": full_prompt, "stream": False},
            timeout=60,
        )

        if resp.status_code == 200:
            ai_reply = resp.json().get("response", "").strip() or \
                       "I'm here to listen — could you share a bit more?"
        else:
            ai_reply = "⚠️ Unable to get a response from the AI right now."

        return {
            "response":      ai_reply,
            "face_emotion":  face_emotion,
            "face_scores":   face_scores,
            "voice_emotion": voice_emotion,
            "voice_conf":    voice_conf,
            "mismatch":      mismatch,
        }

    except requests.exceptions.ConnectionError:
        return {"response": "⚠️ Cannot connect to Ollama. Make sure it's running."}
    except Exception as e:
        print("Error in /analyze_text:", e)
        return {"response": "⚠️ Server error processing your message."}
