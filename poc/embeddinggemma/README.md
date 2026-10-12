# EmbeddingGemma 2 POC

This throwaway comparison covers only the two current API embedding jobs: shot-text retrieval and face-crop identity matching. It uses the A/B story fixtures and the labeled `trip1-v2` cast fixture. No API or app code is changed.

## Run

From the repository root:

```sh
npm install --prefix poc/embeddinggemma
npm run run --prefix poc/embeddinggemma
```

For one optional live Gemini comparison batch, load the main checkout's ignored key into the environment for that command only, then set `GEMINI_BATCH=1`. The runner makes one `batchEmbedContents` request for the 62 descriptions, three story queries and eligible face crops. It writes a marker before the request and refuses to send another batch; it reuses completed aggregate results on rerun. Never copy `.env` or set `MOCK_GEMINI=record`.

The model downloads into Transformers.js's local cache. Inference uses CPU, q4 weights, 768-dimensional EmbeddingGemma 2 vectors, query/document task prompts, and selective configurations: text-only for retrieval, text plus vision for face crops. Raw face vectors are not written to disk; `results.json` contains ranked descriptions and aggregate identity metrics only.
