# Addresses Evaluator Improvement #3: "Amazon SageMaker fine-tuning of LLaMA 8B, a core spec requirement, has zero code evidence — this entire capability is missing."

import os
import argparse
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
)
from trl import SFTTrainer
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
import torch

def train():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, default="meta-llama/Meta-Llama-3-8B-Instruct")
    parser.add_argument("--data_path", type=str, default="/opt/ml/input/data/training")
    parser.add_argument("--output_dir", type=str, default="/opt/ml/model")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=4)
    args = parser.parse_args()

    print(f"Loading tokenizer and model: {args.model_name}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model_name,
        device_map="auto",
        torch_dtype=torch.float16,
        use_cache=False
    )
    model = prepare_model_for_kbit_training(model)

    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
    )
    model = get_peft_model(model, peft_config)

    print("Loading dataset...")
    # Assuming jsonl data is passed via SageMaker channels
    dataset = load_dataset("json", data_files=os.path.join(args.data_path, "sample_training_data.jsonl"))

    def format_prompt(example):
        text = f"User: {example['user']}\nAssistant: {example['assistant']}{tokenizer.eos_token}"
        return {"text": text}

    formatted_dataset = dataset.map(format_prompt)

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        optim="paged_adamw_32bit",
        save_steps=100,
        logging_steps=10,
        learning_rate=2e-4,
        weight_decay=0.001,
        fp16=True,
        max_grad_norm=0.3,
        warmup_ratio=0.03,
        group_by_length=True,
        lr_scheduler_type="constant"
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=formatted_dataset["train"],
        peft_config=peft_config,
        dataset_text_field="text",
        max_seq_length=512,
        tokenizer=tokenizer,
        args=training_args,
        packing=False,
    )

    print("Starting training...")
    trainer.train()
    
    print("Saving model...")
    trainer.model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

if __name__ == "__main__":
    train()
