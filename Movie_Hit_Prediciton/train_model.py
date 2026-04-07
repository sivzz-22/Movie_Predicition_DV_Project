"""
train_model.py
==============
Train a Random Forest classifier on the TMDB 5000 Movies dataset
to predict whether a movie will be a HIT (revenue > 100M) or FLOP.
Saves:
  - model.pkl          (trained classifier + scaler)
  - dataset_stats.json (sample stats for frontend charts)
"""

import pandas as pd
import numpy as np
import pickle
import json
import os
import warnings
warnings.filterwarnings("ignore")

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, classification_report

# ── 1. Load dataset ──────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "tmdb_5000_movies.csv")

print("[1/5] Loading dataset …")
try:
    df = pd.read_csv(CSV_PATH)
    print(f"      Loaded {len(df)} rows from {CSV_PATH}")
except FileNotFoundError:
    # ── Synthetic fallback (no CSV present) ─────────────────────────────────
    print("      CSV not found – generating synthetic training data …")
    np.random.seed(42)
    n = 3000

    budget       = np.random.choice([0, *np.random.randint(1_000_000, 300_000_000, n-200)], n)
    popularity   = np.abs(np.random.normal(25, 20, n))
    runtime      = np.random.normal(105, 20, n).clip(60, 240)
    vote_average = np.random.normal(6.1, 1.0, n).clip(1, 10)

    # Revenue correlated loosely with budget & popularity
    revenue = (budget * 2.5 * np.random.uniform(0.1, 3, n)
               + popularity * 3_000_000
               + np.random.normal(0, 10_000_000, n)).clip(0)

    df = pd.DataFrame({
        "budget":       budget,
        "popularity":   popularity,
        "runtime":      runtime,
        "vote_average": vote_average,
        "revenue":      revenue,
    })

# ── 2. Feature engineering ───────────────────────────────────────────────────
print("[2/5] Pre-processing …")
FEATURES = ["budget", "popularity", "runtime", "vote_average"]
TARGET   = "revenue"

df = df[FEATURES + [TARGET]].dropna()
df = df[df[TARGET] > 0]          # drop rows with no revenue info
df = df[df["budget"] > 0]        # drop rows with no budget info

# Define Hit / Flop
HIT_THRESHOLD = 100_000_000
df["label"] = (df[TARGET] > HIT_THRESHOLD).astype(int)   # 1 = Hit, 0 = Flop

X = df[FEATURES].values
y = df["label"].values

print(f"      Dataset size after filtering: {len(df)} rows")
print(f"      Hits: {y.sum()}  |  Flops: {(y==0).sum()}")

# ── 3. Train / test split ────────────────────────────────────────────────────
print("[3/5] Training model …")
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

scaler  = StandardScaler()
X_train = scaler.fit_transform(X_train)
X_test  = scaler.transform(X_test)

clf = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    random_state=42,
    class_weight="balanced",
    n_jobs=-1,
)
clf.fit(X_train, y_train)

y_pred = clf.predict(X_test)
acc    = accuracy_score(y_test, y_pred)
print(f"      Accuracy: {acc:.4f}")
print(classification_report(y_test, y_pred, target_names=["Flop", "Hit"]))

# ── 4. Save model ────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")
with open(MODEL_PATH, "wb") as f:
    pickle.dump({"model": clf, "scaler": scaler}, f)
print(f"[4/5] Model saved → {MODEL_PATH}")

# ── 5. Export dataset statistics for frontend charts ─────────────────────────
print("[5/5] Exporting dataset stats …")

# Feature importance
importances = clf.feature_importances_.tolist()

# Representative sample (budget bins)
budget_sample   = df["budget"].sample(min(200, len(df)), random_state=42).tolist()
pop_sample      = df["popularity"].sample(min(200, len(df)), random_state=42).tolist()
vote_sample     = df["vote_average"].sample(min(200, len(df)), random_state=42).tolist()
runtime_sample  = df["runtime"].sample(min(200, len(df)), random_state=42).tolist()

# Correlation matrix (rounded)
corr = df[FEATURES].corr().round(3).to_dict()

# Popularity vs hit-rate (bucketed)
df["pop_bucket"] = pd.cut(df["popularity"], bins=10)
pop_hit_rate     = df.groupby("pop_bucket", observed=True)["label"].mean()
pop_labels       = [str(b) for b in pop_hit_rate.index]
pop_values       = pop_hit_rate.tolist()

stats = {
    "accuracy":         round(acc, 4),
    "feature_names":    FEATURES,
    "feature_importance": importances,
    "total_movies":     int(len(df)),
    "hit_count":        int(y.sum()),
    "flop_count":       int((y == 0).sum()),
    "budget_sample":    [round(b / 1_000_000, 2) for b in budget_sample],   # in $M
    "popularity_sample": [round(p, 2) for p in pop_sample],
    "vote_sample":      [round(v, 2) for v in vote_sample],
    "runtime_sample":   [round(r, 2) for r in runtime_sample],
    "pop_labels":       pop_labels,
    "pop_values":       [round(v, 4) for v in pop_values],
    "correlation":      corr,
    "hit_threshold_M":  HIT_THRESHOLD // 1_000_000,
}

STATS_PATH = os.path.join(BASE_DIR, "dataset_stats.json")
with open(STATS_PATH, "w") as f:
    json.dump(stats, f, indent=2)
print(f"      Stats saved → {STATS_PATH}")

print("\n✅  Training complete! Run  python app.py  to start the dashboard.")
