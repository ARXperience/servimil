import express from "express";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/genai";

const app = express();
app.use(express.json({ limit: "25mb" }));

// Inicializa Gemini con tu API Key
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("❌ Falta la variable de entorno GEMINI_API_KEY");
const ai = new GoogleGenerativeAI({ apiKey });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmp = (name) => path.join("/tmp", name || crypto.randomUUID());

// 🔹 Descargar audio desde URL
async function downloadAudio(url) {
  const headers = {};
  // Si es un link de WhatsApp privado, usar token
  if (/graph\.facebook\.com/.test(url)) {
    if (!process.env.META_WA_TOKEN) {
      throw new Error("El audio requiere token de WhatsApp. Define META_WA_TOKEN");
    }
    headers.Authorization = `Bearer ${process.env.META_WA_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`No se pudo descargar audio: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

// 🔹 Transcodificar a WAV 16k mono
async function toWav16k(inputBuf) {
  const inFile = tmp("in.ogg");
  const outFile = tmp("out.wav");
  await fs.writeFile(inFile, inputBuf);

  ffmpeg.setFfmpegPath(ffmpegPath);
  await new Promise((resolve, reject) => {
    ffmpeg(inFile)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .output(outFile)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  const wav = await fs.readFile(outFile);
  await fs.unlink(inFile).catch(() => {});
  await fs.unlink(outFile).catch(() => {});
  return wav;
}

// 🔹 Endpoint principal
app.post("/transcribe", async (req, res) => {
  try {
    const { audio_url, language } = req.body;
    if (!audio_url) return res.status(400).json({ error: "Falta audio_url" });

    // 1) Descargar y transcodificar
    const buf = await downloadAudio(audio_url);
    const wav = await toWav16k(buf);
    const base64 = wav.toString("base64");

    // 2) Llamar a Gemini
    const model = "gemini-2.5-flash";
    const sysPrompt = [
      "Eres un transcriptor fiable.",
      language ? `Idioma esperado: ${language}` : "Idioma esperado: español"
    ].join("\n");

    const result = await ai.models.generateContent({
      model,
      contents: [
        { role: "user", parts: [{ text: sysPrompt }] },
        { role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: base64 } }] }
      ]
    });

    const transcript =
      result?.response?.text?.() ||
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!transcript) throw new Error("Gemini no devolvió texto");

    res.json({ ok: true, transcript });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// 🔹 Healthcheck (para Render)
app.get("/healthz", (_req, res) => res.send("ok"));

// Puerto dinámico
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server corriendo en puerto ${port}`));
