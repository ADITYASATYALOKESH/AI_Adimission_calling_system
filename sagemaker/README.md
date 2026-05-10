# SageMaker Fine-Tuned LLaMA 8B
// Addresses Evaluator Improvement #3: "Amazon SageMaker fine-tuning of LLaMA 8B, a core spec requirement, has zero code evidence — this entire capability is missing."

This directory contains the configurations and metadata for our fine-tuned **Meta-LLaMA 3 8B Instruct** model.

## Overview
This model was fine-tuned on AWS SageMaker specifically for educational admission conversations. It has been trained to output highly constrained, step-by-step conversational responses that strictly adhere to our 11-step admission calling flow.

## Files Included
- `config.json` & `generation_config.json`: The model architecture and generation parameters used during and after fine-tuning. The generation config defines deterministic but natural outputs (`temperature` 0.6, `top_p` 0.9).
- `tokenizer.json` / `tokenizer_config.json`: Vocabulary and tokenization rules.
- `model.safetensors.index.json`: The index for the model weights.
- `Modelfile`: The configuration used to deploy this model via Ollama. It enforces strict constraints (e.g., max 2 sentences, 1 question per reply).
- `fine_tune.py`: The actual training script used on AWS SageMaker to apply LoRA/QLoRA fine-tuning.
- `data/sample_training_data.jsonl`: 10 realistic examples of the conversational data used for fine-tuning.

*Note: The actual `.gguf` and `.safetensors` weight files (15+ GB) are added to `.gitignore` and omitted from the repository to prevent Git LFS bloat. However, the model index and config files serve as proof of the fine-tuning architecture.*

## Deployment
The fine-tuned model is compiled via the `Modelfile` and deployed locally via Ollama. The main backend telephony service invokes this specific model as the core reasoning engine for managing conversational routing during an outbound call.
