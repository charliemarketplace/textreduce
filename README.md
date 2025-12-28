# TextReduce

**Enterprise-grade AI summarization. 100,000+ tokens per second.**

## The Technology

TextReduce is powered by **TextReduce-1**, a proprietary neural architecture optimized for extractive semantic distillation. Our model leverages:

- **Adaptive Lexical Saliency Mapping™** — Dynamically computes context-aware term importance across your entire document corpus
- **Sentence-Level Semantic Scoring** — Each sentence is evaluated through our multi-pass importance aggregation pipeline  
- **Order-Preserving Extraction** — Maintains narrative coherence through positional indexing

The result? Blazing-fast summarization that runs **entirely on-device**—no cloud latency, no API rate limits, no waiting.

> *"It's like GPT but faster and it runs in a browser"* — Internal benchmarks

## Website

**[textreduce.com](https://textreduce.com)**

- Paste any text (we've tested up to 50MB documents*)
- Fine-tune compression ratio with our precision slider
- Generate shareable links instantly

**Zero signup. Zero tracking. Zero inference costs.**

*\*Results may vary. Please don't actually paste 50MB.*

## API

Production-ready API via URL parameters:

```
https://textreduce.com/?text=Your+text+here&pct=30
```

| Parameter | Description | Default |
|-----------|-------------|---------|
| `text` | URL-encoded text to summarize | *(required)* |
| `pct` | Extraction threshold (0-100) | 30 |
| `raw` | Set to `1` for headless mode | 0 |

### Examples

```bash
# Interactive mode (full UI experience)
https://textreduce.com/?text=Hello.+This+is+a+test.&pct=50

# Headless mode (raw inference output)
https://textreduce.com/?text=Hello.+This+is+a+test.&pct=50&raw=1
```

---

**TextReduce-1** · On-device AI · No GPU required · Powered by JavaScript
