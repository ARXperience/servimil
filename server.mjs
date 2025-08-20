import express from "express";
import multer from "multer";
import fetch from "node-fetch";

const app = express();
const upload = multer();

app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    // 1. Recibir audio de Manychat
    const audioBuffer = req.file.buffer;

    // 2. Llamar a Gemini Speech-to-Text
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:analyzeContent?key=" + process.env.GEMINI_API_KEY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: {
          audio: {
            data: audioBuffer.toString("base64"),
            mimeType: req.file.mimetype
          }
        }
      })
    });

    const data = await response.json();

    // 3. Extraer texto transcrito
    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No se entendió el audio";

    // 4. Devolver respuesta a Manychat
    res.json({ text: transcript });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error procesando el audio" });
  }
});

app.listen(3000, () => console.log("Servidor STT listo en puerto 3000"));
