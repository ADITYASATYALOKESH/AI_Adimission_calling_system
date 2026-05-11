import pandas as pd
import json
import os
from datetime import datetime

class DataPipeline:
    def __init__(self, raw_data_path="data/raw", processed_data_path="data/processed"):
        self.raw_data_path = raw_data_path
        self.processed_data_path = processed_data_path
        os.makedirs(self.raw_data_path, exist_ok=True)
        os.makedirs(self.processed_data_path, exist_ok=True)

    def extract_features(self, call_data):
        """
        Extract features from raw call data for ML training.
        This transforms unstructured report data into structured ML features.
        """
        try:
            report = call_data.get('report', {})
            profile = report.get('profile', {})
            topics = report.get('topicAnalysis', {})
            call_info = call_data.get('callId', {})
            
            features = {
                'call_duration': call_info.get('duration', 0),
                'sentiment_score': 1 if call_info.get('sentiment') == 'positive' else (0 if call_info.get('sentiment') == 'neutral' else -1),
                'tenth_percentile': profile.get('tenthPercent') or 0,
                'twelfth_percentile': profile.get('twelfthPercent') or 0,
                'interest_fees': topics.get('fees', 0),
                'interest_scholarship': topics.get('scholarship', 0),
                'interest_placement': topics.get('placement', 0),
                'interest_hostel': topics.get('hostel', 0),
                'interest_courseDetails': topics.get('courseDetails', 0),
                'interest_admissionProcess': topics.get('admissionProcess', 0),
                # Target variable
                'enrolled': 1 if call_data.get('status') == 'enrolled' else 0
            }
            return features
        except Exception as e:
            print(f"Error extracting features: {e}")
            return None

    def process_batch(self, input_file):
        """Process a batch of raw call data exports into training ready format"""
        print(f"Processing {input_file}...")
        try:
            with open(os.path.join(self.raw_data_path, input_file), 'r') as f:
                data = json.load(f)
                
            features_list = [self.extract_features(item) for item in data]
            df = pd.DataFrame([f for f in features_list if f is not None])
            
            output_file = f"features_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            df.to_csv(os.path.join(self.processed_data_path, output_file), index=False)
            print(f"Successfully processed {len(df)} records to {output_file}")
            return True
        except Exception as e:
            print(f"Pipeline failed: {e}")
            return False

if __name__ == "__main__":
    print("Initialize Data Pipeline (Phase 4)")
    pipeline = DataPipeline()
    # Mock data generation
    with open("data/raw/sample.json", "w") as f:
        json.dump([
            {"status": "enrolled", "callId": {"duration": 180, "sentiment": "positive"}, "report": {"topicAnalysis": {"scholarship": 80, "placement": 90}}}
        ], f)
    pipeline.process_batch("sample.json")
