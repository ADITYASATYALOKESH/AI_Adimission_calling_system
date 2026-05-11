import os
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import joblib

class EnrollmentPredictor:
    def __init__(self, model_path="models"):
        self.model_path = model_path
        os.makedirs(self.model_path, exist_ok=True)
        self.model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)

    def load_data(self, data_path):
        """Load processed features data"""
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Data not found at {data_path}")
        return pd.read_csv(data_path)

    def train(self, data_path):
        """Train the enrollment probability model"""
        print("Starting model training phase...")
        df = self.load_data(data_path)
        
        if df.empty or len(df) < 10:
            print("Not enough data to train. Generating synthetic data for scaffold testing...")
            # Generate synthetic data for the sake of the scaffold
            df = pd.DataFrame({
                'call_duration': [120, 240, 60, 300, 180, 90, 45, 200, 150, 260],
                'sentiment_score': [1, 1, -1, 1, 0, -1, -1, 1, 0, 1],
                'interest_placement': [80, 90, 20, 95, 50, 10, 0, 85, 60, 100],
                'enrolled': [1, 1, 0, 1, 0, 0, 0, 1, 0, 1]
            })

        X = df.drop('enrolled', axis=1)
        y = df['enrolled']
        
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        self.model.fit(X_train, y_train)
        
        preds = self.model.predict(X_test)
        print("Training completed. Evaluation:")
        print(f"Accuracy: {accuracy_score(y_test, preds):.2f}")
        
        model_file = os.path.join(self.model_path, "enrollment_rf_model.pkl")
        joblib.dump(self.model, model_file)
        print(f"Model saved to {model_file}")

    def predict(self, features):
        """Predict probability of enrollment"""
        return self.model.predict_proba(features)[:, 1]

if __name__ == "__main__":
    print("Initialize Enrollment Predictor (Phase 4)")
    predictor = EnrollmentPredictor()
    
    # In production, we would point this to the latest processed data
    try:
        predictor.train("data/processed/latest_features.csv")
    except Exception as e:
        print(f"Mocking data for training: {e}")
        predictor.train("data/mock.csv")
