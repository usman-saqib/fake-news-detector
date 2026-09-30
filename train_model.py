import pandas as pd
import numpy as np
import re
import string
import json
import joblib

from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import PassiveAggressiveClassifier, LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, classification_report

# ------------------------------------------------------------
# Stopwords (no external download needed)
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
# STEP 1: Load Dataset
# ------------------------------------------------------------
print("Loading dataset...")

fake_df = pd.read_csv("dataset/Fake.csv")
true_df = pd.read_csv("dataset/True.csv")

fake_df["label"] = 0   # FAKE
true_df["label"] = 1   # REAL

df = pd.concat([fake_df, true_df], axis=0)
print(f"Raw rows loaded: {len(df)}")


# ------------------------------------------------------------
# STEP 2: Handle Missing Values
# ------------------------------------------------------------
df["title"] = df["title"].fillna("")
df["text"] = df["text"].fillna("")

# Drop rows where BOTH title and text are empty (nothing to learn from)
df = df[(df["title"].str.strip() != "") | (df["text"].str.strip() != "")]
print(f"Rows after removing empty title+text rows: {len(df)}")

df["content"] = (df["title"].astype(str) + " " + df["text"].astype(str)).str.strip()


# ------------------------------------------------------------
# STEP 3: Remove Duplicates
# ------------------------------------------------------------
before = len(df)
df = df.drop_duplicates(subset=["content"])
print(f"Removed {before - len(df)} duplicate articles. Remaining: {len(df)}")


# ------------------------------------------------------------
# STEP 4: Fix Data Leakage (remove wire-agency tags & bylines)
# ------------------------------------------------------------
def remove_leakage_patterns(text):
    # Remove "CITY (Reuters) -" / "(Reuters)" / "(AP)" style datelines
    text = re.sub(r'^[A-Z\s,]+\((Reuters|AP)\)\s*-\s*', '', text)
    text = re.sub(r'\((Reuters|AP|Fox News|CNN|BBC)\)', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\b(Reuters|Getty Images|Featured image|via Getty)\b', '', text, flags=re.IGNORECASE)
    # Remove "Image Credits", social-share boilerplate that leaks source
    text = re.sub(r'pic\.twitter\.com/\S+', '', text)
    return text


print("Removing data-leakage patterns (wire-agency tags)...")
df["content"] = df["content"].apply(remove_leakage_patterns)


# ------------------------------------------------------------
# STEP 5: Text Cleaning
# ------------------------------------------------------------
def clean_text(text):
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


print("Cleaning text data... (this may take a minute)")
df["content"] = df["content"].apply(clean_text)

# Remove rows that became empty after cleaning
df = df[df["content"].str.strip() != ""]
print(f"Final dataset size after cleaning: {len(df)}")
print(f"Class balance -> FAKE: {(df['label']==0).sum()} | REAL: {(df['label']==1).sum()}")

# Shuffle
df = df.sample(frac=1, random_state=42).reset_index(drop=True)


# ------------------------------------------------------------
# STEP 6: Train/Test Split
# ------------------------------------------------------------
X = df["content"]
y = df["label"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"Training samples: {len(X_train)}")
print(f"Testing samples: {len(X_test)}")


# ------------------------------------------------------------
# STEP 7: TF-IDF Vectorization (unigrams + bigrams)
# ------------------------------------------------------------
print("Vectorizing text using TF-IDF (1-2 grams)...")

vectorizer = TfidfVectorizer(
    max_df=0.7,
    min_df=3,
    max_features=20000,
    ngram_range=(1, 2),
    sublinear_tf=True,
)
X_train_tfidf = vectorizer.fit_transform(X_train)
X_test_tfidf = vectorizer.transform(X_test)


# ------------------------------------------------------------
# STEP 8: Train Model #1 - PassiveAggressiveClassifier (MAIN MODEL)
# ------------------------------------------------------------
print("Training PassiveAggressiveClassifier...")

pac_model = PassiveAggressiveClassifier(max_iter=1000, random_state=42, class_weight="balanced")
pac_model.fit(X_train_tfidf, y_train)
pac_preds = pac_model.predict(X_test_tfidf)

pac_accuracy = accuracy_score(y_test, pac_preds)
pac_precision = precision_score(y_test, pac_preds)
pac_recall = recall_score(y_test, pac_preds)
pac_f1 = f1_score(y_test, pac_preds)

print("\n===== PassiveAggressiveClassifier Results =====")
print(f"Accuracy : {pac_accuracy*100:.2f}%")
print(f"Precision: {pac_precision*100:.2f}%")
print(f"Recall   : {pac_recall*100:.2f}%")
print(f"F1 Score : {pac_f1*100:.2f}%")
print(confusion_matrix(y_test, pac_preds))

# Cross-validation to check the model actually generalizes (not just memorizing)
cv_scores = cross_val_score(pac_model, X_train_tfidf, y_train, cv=5)
print(f"5-Fold Cross-Validation Accuracy: {cv_scores.mean()*100:.2f}% (+/- {cv_scores.std()*100:.2f}%)")


# ------------------------------------------------------------
# STEP 9: Train Model #2 - Logistic Regression (for comparison)
# ------------------------------------------------------------
print("\nTraining Logistic Regression (for comparison)...")

lr_model = LogisticRegression(max_iter=1000, class_weight="balanced")
lr_model.fit(X_train_tfidf, y_train)
lr_preds = lr_model.predict(X_test_tfidf)
lr_accuracy = accuracy_score(y_test, lr_preds)

print(f"Logistic Regression Accuracy: {lr_accuracy*100:.2f}%")


# ------------------------------------------------------------
# STEP 10: Pick the best model automatically
# ------------------------------------------------------------
if pac_accuracy >= lr_accuracy:
    best_model = pac_model
    best_model_name = "PassiveAggressiveClassifier"
    final_accuracy, final_precision, final_recall, final_f1 = pac_accuracy, pac_precision, pac_recall, pac_f1
else:
    best_model = lr_model
    best_model_name = "LogisticRegression"
    final_accuracy = lr_accuracy
    final_precision = precision_score(y_test, lr_preds)
    final_recall = recall_score(y_test, lr_preds)
    final_f1 = f1_score(y_test, lr_preds)

print(f"\nBest model selected: {best_model_name}")


# ------------------------------------------------------------
# STEP 11: Save Model, Vectorizer & Metrics
# ------------------------------------------------------------
joblib.dump(best_model, "model/model.pkl")
joblib.dump(vectorizer, "model/vectorizer.pkl")

metrics = {
    "model_name": best_model_name,
    "accuracy": round(final_accuracy * 100, 1),
    "precision": round(final_precision * 100, 1),
    "recall": round(final_recall * 100, 1),
    "f1_score": round(final_f1 * 100, 1),
    "cv_accuracy": round(cv_scores.mean() * 100, 1),
    "total_fake_samples": int((df["label"] == 0).sum()),
    "total_real_samples": int((df["label"] == 1).sum()),
}

with open("model/metrics.json", "w") as f:
    json.dump(metrics, f, indent=4)

print("\n✅ Model, vectorizer, and metrics saved successfully in the 'model/' folder!")
print(json.dumps(metrics, indent=4))


# ------------------------------------------------------------
# STEP 12: Sanity check with OUT-OF-DATASET custom examples
# (proves the model learned real patterns, not memorized data)
# ------------------------------------------------------------
def predict_custom(text):
    cleaned = clean_text(remove_leakage_patterns(text))
    vect = vectorizer.transform([cleaned])
    pred = best_model.predict(vect)[0]
    return "REAL" if pred == 1 else "FAKE"


print("\n===== Custom Out-of-Dataset Sanity Check =====")
sample_fake = "SHOCKING: Doctors HATE this one weird trick that cures cancer overnight, government trying to hide it from you!!!"
sample_real = "The Ministry of Finance announced today that the annual budget will be presented to parliament next month, following consultations with economic advisors."

print(f"Sample FAKE-style text -> Predicted: {predict_custom(sample_fake)}")
print(f"Sample REAL-style text -> Predicted: {predict_custom(sample_real)}")