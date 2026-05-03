import sys
import json
import joblib
import pandas as pd
import os

# Load model
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(BASE_DIR, "anomaly_model.pkl")
model = joblib.load(model_path)

# Get input
input_data = json.loads(sys.argv[1])

# ✅ FIX: correct DataFrame
df = pd.DataFrame(input_data, columns=["co2_emitted"])

# Safety
if len(df) < 5:
    print(json.dumps({"risk_score": 0}))
    exit()

# Feature engineering
df["rolling_mean"] = df["co2_emitted"].rolling(window=5).mean()
df["rolling_std"] = df["co2_emitted"].rolling(window=5).std()

df["rolling_mean"] = df["rolling_mean"].fillna(df["co2_emitted"])
df["rolling_std"] = df["rolling_std"].fillna(0)

# ✅ MATCH training features
features = df[[
    "co2_emitted",
    "rolling_mean",
    "rolling_std"
]]

scores = model.decision_function(features)

risk_score = float(abs(scores[-1]))

print(json.dumps({
    "risk_score": risk_score
}))