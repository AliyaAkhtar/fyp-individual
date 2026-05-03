import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib

df = pd.read_csv("historical_emissions.csv")

print("Original dataset size:", len(df))

# Feature engineering
df["rolling_mean"] = df["co2_emitted"].rolling(window=5).mean()
df["rolling_std"] = df["co2_emitted"].rolling(window=5).std()

df["rolling_mean"] = df["rolling_mean"].fillna(df["co2_emitted"])
df["rolling_std"] = df["rolling_std"].fillna(0)

features = df[[
    "co2_emitted",
    "rolling_mean",
    "rolling_std"
]]

print("Training samples:", len(features))

model = IsolationForest(
    contamination=0.05,
    random_state=42
)

model.fit(features)

joblib.dump(model, "anomaly_model.pkl")

print("Model trained and saved.")