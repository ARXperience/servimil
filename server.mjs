import express from "express";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai"; // <-- aquí el cambio

const app = express();
app.use(express.json({ limit: "25mb" }));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Falta GEMINI_API_KEY");
const genAI = new GoogleGenerativeAI(apiKey);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmp = (name) => path.join("/tmp", name || crypto.randomUUID());

async function downloadAudio(url) {
  const headers = {};
  if (/graph\.facebook\.com|lookaside\.fbcdn\.net|\.fbsbx\.com/.test(url)) {
    if (!process.env.META_WA_TOKEN) throw new Error("Falta META_WA_TOKEN para WhatsApp");
    headers.Authorization = `Bearer ${process.env.META_WA_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`No se pudo descargar audio: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function toWav16k(inputBuf) {
  const inFile = tmp("in.ogg");
  const outFile = tmp("out.wav");
  await fs.writeFile(inFile, inputBuf);
  ffmpeg.setFfmpegPath(ffmpegPath);
  await new Promise((resolve, reject) => {
    ffmpeg(inFile).audioChannels(1).audioFrequency(16000).format("wav")
      .output(outFile).on("end", resolve).on("error", reject).run();
  });
  const wav = await fs.readFile(outFile);
  await fs.unlink(inFile).catch(()=>{});
  await fs.unlink(outFile).catch(()=>{});
  return wav;
}

app.post("/transcribe", async (req, res) => {
  try {
    const { audio_url, language, prompt } = req.body || {};
    if (!audio_url) return res.status(400).json({ error: "Falta audio_url" });

    const buf = await downloadAudio(audio_url);
    const wav = await toWav16k(buf);
    const base64 = wav.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const sys = [
      "Eres un transcriptor fiable. Devuelve solo lo dicho en el audio.",
      language ? `Idioma esperado: ${language}` : "Idioma esperado: español",
      prompt ? `Instrucción: ${prompt}` : null
    ].filter(Boolean).join("\n");

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: sys }] },
        { role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: base64 } }] }
      ]
    });

    const transcript = result.response.text();
    if (!transcript) throw new Error("Gemini no devolvió texto");

    res.json({ ok: true, transcript, reply: transcript });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server corriendo en puerto ${port}`));
