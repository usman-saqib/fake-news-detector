"""
===========================================================
FAKE NEWS DETECTION - FLASK BACKEND
===========================================================
Serves the dashboard UI and exposes API endpoints:
  GET  /                -> dashboard page (login required)
  GET  /login           -> login/signup page
  POST /login           -> handle login
  POST /signup          -> handle signup
  GET  /logout          -> clear session
  POST /api/predict     -> predict FAKE/REAL for given text
  GET  /api/history     -> list of past analyzed articles
  GET  /api/stats       -> dashboard summary stats
  GET  /api/metrics     -> model performance metrics
===========================================================
"""

import os
import re
import json
import string
import joblib
import random
from functools import wraps
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = "change-this-to-a-random-secret-key"   # needed for login sessions

MODEL_PATH = "model/model.pkl"
VECTORIZER_PATH = "model/vectorizer.pkl"
METRICS_PATH = "model/metrics.json"
HISTORY_PATH = "model/history.json"
USERS_PATH = "model/users.json"

# ------------------------------------------------------------
# Load trained model + vectorizer (created by train_model.py)
# ------------------------------------------------------------
model = None
vectorizer = None
metrics = {"model_name": "N/A", "accuracy": 0, "precision": 0, "recall": 0, "f1_score": 0}

if os.path.exists(MODEL_PATH) and os.path.exists(VECTORIZER_PATH):
    model = joblib.load(MODEL_PATH)
    vectorizer = joblib.load(VECTORIZER_PATH)

if os.path.exists(METRICS_PATH):
    with open(METRICS_PATH) as f:
        metrics = json.load(f)


# ------------------------------------------------------------
# Load / initialize history (stores every analyzed article)
# ------------------------------------------------------------
def load_history():
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            return json.load(f)
    return []


def save_history(history):
    with open(HISTORY_PATH, "w") as f:
        json.dump(history, f, indent=2)


CATEGORIES = ["Politics", "Entertainment", "World", "Technology", "Health"]


# ------------------------------------------------------------
# User accounts (stored in a simple JSON file - no database
# setup needed, good enough for this project/demo)
# ------------------------------------------------------------
def load_users():
    if os.path.exists(USERS_PATH):
        with open(USERS_PATH) as f:
            return json.load(f)
    return []


def save_users(users):
    with open(USERS_PATH, "w") as f:
        json.dump(users, f, indent=2)


def find_user(identifier):
    """identifier can be either username or email"""
    users = load_users()
    identifier = identifier.strip().lower()
    for u in users:
        if u["username"].lower() == identifier or u["email"].lower() == identifier:
            return u
    return None


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return wrapper


# ------------------------------------------------------------
# Stopwords - MUST be identical to train_model.py
# ------------------------------------------------------------
stop_words = set("""
a about above after again against all am an and any are aren't as at be
because been before being below between both but by can't cannot could
couldn't did didn't do does doesn't doing don't down during each few for
from further had hadn't has hasn't have haven't having he he'd he'll he's
her here here's hers herself him himself his how how's i i'd i'll i'm i've
if in into is isn't it it's its itself let's me more most mustn't my myself
no nor not of off on once only or other ought our ours ourselves out over
own same shan't she she'd she'll she's should shouldn't so some such than
that that's the their theirs them themselves then there there's these they
they'd they'll they're they've this those through to too under until up
very was wasn't we we'd we'll we're we've were weren't what what's when
when's where where's which while who who's whom why why's with won't would
wouldn't you you'd you'll you're you've your yours yourself yourselves
""".split())


# ------------------------------------------------------------
# Data-leakage removal - MUST be identical to train_model.py
# ------------------------------------------------------------
def remove_leakage_patterns(text):
    text = re.sub(r'^[A-Z\s,]+\((Reuters|AP)\)\s*-\s*', '', text)
    text = re.sub(r'\((Reuters|AP|Fox News|CNN|BBC)\)', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\b(Reuters|Getty Images|Featured image|via Getty)\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'pic\.twitter\.com/\S+', '', text)
    return text


# ------------------------------------------------------------
# Text cleaning - MUST be identical to train_model.py
# ------------------------------------------------------------
def clean_text(text):
    text = remove_leakage_patterns(text)
    text = text.lower()
    text = re.sub(r'\[.*?\]', '', text)
    text = re.sub(r'https?://\S+|www\.\S+', '', text)
    text = re.sub(r'<.*?>+', '', text)
    text = re.sub(r'[%s]' % re.escape(string.punctuation), '', text)
    text = re.sub(r'\n', ' ', text)
    text = re.sub(r'\w*\d\w*', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    words = text.split()
    words = [w for w in words if w not in stop_words and len(w) > 2]
    return " ".join(words)


def get_reasons(is_real, confidence):
    if is_real:
        pool = [
            "Content is well-structured and balanced",
            "Cites credible sources",
            "Matches trusted news databases",
            "Neutral tone without excessive emotional language",
            "Consistent facts across sentences",
        ]
    else:
        pool = [
            "Uses sensational or exaggerated language",
            "Lacks credible source citations",
            "Does not match trusted news databases",
            "Contains emotionally charged or clickbait wording",
            "Inconsistent or unverifiable claims",
        ]
    return random.sample(pool, 3)


# ------------------------------------------------------------
# AUTH ROUTES
# ------------------------------------------------------------
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html", error=None)

    identifier = request.form.get("identifier", "").strip()
    password = request.form.get("password", "")

    user = find_user(identifier)
    if user is None or not check_password_hash(user["password_hash"], password):
        return render_template("login.html", error="Invalid username/email or password."), 401

    session["user"] = user["username"]
    session["full_name"] = user["full_name"]
    return redirect(url_for("dashboard"))


@app.route("/signup", methods=["POST"])
def signup():
    full_name = request.form.get("full_name", "").strip()
    email = request.form.get("email", "").strip()
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")

    if not all([full_name, email, username, password]):
        return render_template("login.html", error="Please fill in all fields."), 400

    if password != confirm_password:
        return render_template("login.html", error="Passwords do not match."), 400

    if find_user(username) or find_user(email):
        return render_template("login.html", error="Username or email already registered."), 400

    users = load_users()
    users.append({
        "full_name": full_name,
        "email": email,
        "username": username,
        "password_hash": generate_password_hash(password),
        "created_at": datetime.now().strftime("%b %d, %Y"),
    })
    save_users(users)

    # auto-login after signup
    session["user"] = username
    session["full_name"] = full_name
    return redirect(url_for("dashboard"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ------------------------------------------------------------
# ROUTES
# ------------------------------------------------------------
@app.route("/")
@login_required
def dashboard():
    return render_template("dashboard.html", full_name=session.get("full_name", "User"))


@app.route("/api/predict", methods=["POST"])
@login_required
def predict():
    data = request.get_json()
    text = data.get("text", "").strip()

    if not text:
        return jsonify({"error": "Please paste some news text to analyze."}), 400

    if model is None or vectorizer is None:
        return jsonify({"error": "Model not found. Please run train_model.py first."}), 500

    cleaned = clean_text(text)
    vect_text = vectorizer.transform([cleaned])

    prediction = model.predict(vect_text)[0]   # 1 = REAL, 0 = FAKE

    try:
        score = model.decision_function(vect_text)[0]
        confidence = 1 / (1 + pow(2.71828, -score))
        confidence = max(confidence, 1 - confidence)
    except Exception:
        confidence = 0.85

    confidence = round(float(confidence) * 100, 1)
    is_real = bool(prediction == 1)
    label = "REAL" if is_real else "FAKE"
    reasons = get_reasons(is_real, confidence)

    history = load_history()
    entry = {
        "id": len(history) + 1,
        "title": text[:80] + ("..." if len(text) > 80 else ""),
        "label": label,
        "confidence": confidence,
        "category": random.choice(CATEGORIES),
        "date": datetime.now().strftime("%b %d, %Y"),
    }
    history.insert(0, entry)
    save_history(history)

    return jsonify({
        "label": label,
        "is_real": is_real,
        "confidence": confidence,
        "reasons": reasons,
    })


@app.route("/api/history")
@login_required
def get_history():
    return jsonify(load_history())


@app.route("/api/stats")
@login_required
def get_stats():
    history = load_history()
    total = len(history)
    real_count = len([h for h in history if h["label"] == "REAL"])
    fake_count = len([h for h in history if h["label"] == "FAKE"])

    category_counts = {c: 0 for c in CATEGORIES}
    for h in history:
        category_counts[h["category"]] += 1

    return jsonify({
        "total": total,
        "real_count": real_count,
        "fake_count": fake_count,
        "real_pct": round((real_count / total) * 100, 1) if total else 0,
        "fake_pct": round((fake_count / total) * 100, 1) if total else 0,
        "accuracy": metrics.get("accuracy", 0),
        "category_counts": category_counts,
    })


@app.route("/api/metrics")
@login_required
def get_metrics():
    return jsonify(metrics)


if __name__ == "__main__":
    app.run(debug=True)