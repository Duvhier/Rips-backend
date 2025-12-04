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

// Puerto dinámico para Vercel (usará process.env.PORT)
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===============================
//    API: Procesar Imagen
// ===============================
app.post('/api/process-image', async (req, res) => {
  try {
    const { imageData, mediaType } = req.body;

    // DEBUG: Verificar variables de entorno en Vercel
    console.log('=== VERCEL ENV DEBUG ===');
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
    console.log('GOOGLE_API_KEY exists:', !!process.env.GOOGLE_API_KEY);
    console.log('PORT:', process.env.PORT);

    // Usar GEMINI_API_KEY (o cambiar a GOOGLE_API_KEY según prefieras)
    const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!API_KEY) {
      console.error('ERROR: No API key found in environment variables');
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('API')));
      throw new Error('API key no está configurada. Verifica las variables de entorno en Vercel.');
    }

    // Log parcial de la clave (solo primeros chars por seguridad)
    console.log('API Key starts with:', API_KEY.substring(0, 6) + '...');

    // Llamada a Google Gemini 2.0 Flash
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    console.log('Sending request to Gemini API...');

    const response = await fetch(apiURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `
Analiza EXHAUSTIVAMENTE esta imagen de una agenda médica fila por fila.
Tu objetivo es extraer TODOS los pacientes que asistieron, sin omitir ninguno.

Criterio de inclusión:
- Pacientes que tienen una marca de verificación (✓, check, o similar) en la columna "LLEGO".
- O pacientes donde la casilla "LLEGO" está marcada/rellena.

Instrucciones paso a paso:
1. Escanea la imagen de arriba a abajo, fila por fila.
2. Verifica CADA fila. Si la columna "LLEGO" tiene una marca, EXTRAE los datos.
3. No te detengas hasta llegar al final de la lista.
4. Asegúrate de contar y extraer TODAS las filas marcadas visualmente.

Para cada paciente identificado, extrae:
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
    console.log('Gemini API Status:', response.status);
    console.log('Gemini API Response:', JSON.stringify(json, null, 2));

    // Manejo de errores de API
    if (json.error) {
      console.error('API Error:', json.error);
      throw new Error(`API Error: ${json.error.message || 'Unknown error'}`);
    }

    if (!json.candidates || !json.candidates[0]) {
      console.error('Respuesta inválida del modelo:', JSON.stringify(json, null, 2));
      throw new Error('Respuesta inválida del modelo. Verifica los logs para más detalles.');
    }

    // Verificar si hay bloqueo por seguridad
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      throw new Error(`Contenido bloqueado por seguridad: ${json.promptFeedback.blockReason}`);
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

    console.log('Successfully parsed', parsed.length, 'patients');
    res.json(parsed);

  } catch (error) {
    console.error('Error en /api/process-image:', error);
    res.status(500).json({
      error: error.message,
      note: 'Verifica que la API key esté configurada en Vercel Environment Variables'
    });
  }
});

// ===============================
//    Health Check para Vercel
// ===============================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT || 3001
  });
});

// ===============================
//    Manejo de rutas no encontradas
// ===============================
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 API Key configurada: ${!!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)}`);
});