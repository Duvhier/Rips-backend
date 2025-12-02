// backend/server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===============================
//    API: Procesar Imagen
// ===============================
app.post('/api/process-image', async (req, res) => {
  try {
    const { imageData, mediaType } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY no está configurada en .env');
    }

    // Llamada a Google Gemini 2.0 Flash (gratuito)
    const apiURL =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(apiURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `
Analiza esta imagen de una agenda médica y extrae ÚNICAMENTE los pacientes 
que tienen una marca de verificación (✓) en la columna "LLEGO" o que claramente se ve que asistieron.

Para cada paciente marcado, extrae:
- FECHA (formato: YYYY/MM/DD)
- HORA (HH:MM)
- NOMBRE (mayúsculas)
- IDENTIDAD (solo números)
- EDAD (solo el número)

IMPORTANTE:
Responde ÚNICAMENTE con un array JSON puro, sin texto externo, sin comentarios, 
sin explicaciones, sin bloques markdown.
`
              },
              {
                inline_data: {
                  mime_type: mediaType,
                  data: imageData
                }
              }
            ]
          }
        ]
      })
    });

    const json = await response.json();

    // Log completo para debugging
    console.log('Gemini API Response:', JSON.stringify(json, null, 2));

    // Verificar si hay bloqueo por seguridad
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      throw new Error(`Contenido bloqueado por seguridad: ${json.promptFeedback.blockReason}`);
    }

    if (!json.candidates || !json.candidates[0]) {
      console.error('Respuesta inválida del modelo:', JSON.stringify(json, null, 2));
      throw new Error('Respuesta inválida del modelo. Verifica los logs para más detalles.');
    }

    // Verificar si el contenido fue filtrado
    const candidate = json.candidates[0];
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
      throw new Error(`Contenido filtrado por: ${candidate.finishReason}`);
    }

    // Gemini devuelve en: candidates[0].content.parts[0].text
    const rawText = json.candidates[0].content.parts[0].text.trim();

    // Limpiar si accidentalmente agrega ```json
    const cleanJson = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleanJson);
    } catch (err) {
      console.error("No se pudo parsear JSON:", cleanJson);
      return res.status(400).json({
        error: "Error al parsear respuesta del modelo",
        raw: cleanJson
      });
    }

    res.json(parsed);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===============================

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
