
import os
import json
import pickle
import numpy as np
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")
STATS_PATH = os.path.join(BASE_DIR, "dataset_stats.json")

# ── Load model once at startup ────────────────────────────────────────────────
def load_model():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"model.pkl not found at {MODEL_PATH}. "
            "Please run  python train_model.py  first."
        )
    with open(MODEL_PATH, "rb") as f:
        bundle = pickle.load(f)
    return bundle["model"], bundle["scaler"]

try:
    clf, scaler = load_model()
    print("✅  Model loaded successfully.")
except FileNotFoundError as e:
    print(f"⚠️   {e}")
    clf = scaler = None

# ── Load dataset stats ────────────────────────────────────────────────────────
def load_stats():
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH, "r") as f:
            return json.load(f)
    return {}

dataset_stats = load_stats()

# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the single-page dashboard."""
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():
    """
    Expects JSON body:
      { "budget": <float>, "popularity": <float>,
        "runtime": <float>, "vote_average": <float> }

    Returns:
      { "prediction": "Hit"|"Flop",
        "probability": <float 0-1>,
        "hit_prob": <float>,
        "flop_prob": <float>,
        "inputs": { ... } }
    """
    if clf is None:
        return jsonify({"error": "Model not loaded. Run train_model.py first."}), 500

    data = request.get_json(force=True)

    try:
        budget       = float(data["budget"])
        popularity   = float(data["popularity"])
        runtime      = float(data["runtime"])
        vote_average = float(data["vote_average"])
    except (KeyError, ValueError) as e:
        return jsonify({"error": f"Invalid input: {e}"}), 400

    X       = np.array([[budget, popularity, runtime, vote_average]])
    X_sc    = scaler.transform(X)
    pred    = int(clf.predict(X_sc)[0])
    probas  = clf.predict_proba(X_sc)[0]   # [flop_prob, hit_prob]
    hit_p   = float(probas[1])
    flop_p  = float(probas[0])

    return jsonify({
        "prediction":  "Hit"  if pred == 1 else "Flop",
        "probability": round(hit_p * 100, 2) if pred == 1 else round(flop_p * 100, 2),
        "hit_prob":    round(hit_p * 100, 2),
        "flop_prob":   round(flop_p * 100, 2),
        "inputs": {
            "budget":       budget,
            "popularity":   popularity,
            "runtime":      runtime,
            "vote_average": vote_average,
        }
    })


@app.route("/dataset-stats")
def get_stats():
    """Return pre-computed dataset statistics for initializing frontend charts."""
    return jsonify(dataset_stats)


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=True, port=5000)
