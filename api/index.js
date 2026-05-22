import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import authRoutes from '../routes/auth.js';
import { verifyToken } from '../middleware/auth.js';
import Activity from '../models/Activity.js';

dotenv.config();

// ── ENV VALIDATION (runs on every cold start) ──────────────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY'];
const missingEnv   = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missingEnv.length > 0) {
  console.error('❌ MISSING ENVIRONMENT VARIABLES:', missingEnv.join(', '));
  console.error('👉 Go to Vercel Dashboard → Your Project → Settings → Environment Variables and add them, then Redeploy.');
}

const app = express();

app.use(cors({
  origin: true, // Allow all origins for Vercel dynamic URLs
  credentials: true
}));
app.options('*', cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());

// Serverless-safe MongoDB Connection
const mongoUri = process.env.MONGO_URI;

if (!mongoUri && process.env.NODE_ENV !== 'development') {
  console.error("FATAL ERROR: MONGO_URI is missing. Please add it to your Vercel Environment Variables!");
}

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  console.log("Connecting to MongoDB Atlas...");
  cachedDb = await mongoose.connect(mongoUri || "mongodb://localhost:27017/chatsol", {
    serverSelectionTimeoutMS: 8000, // Wait up to 8s for Vercel cold starts
    bufferCommands: false
  });
  return cachedDb;
}

// Configure Gemini API
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is missing from environment variables!");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Routes
app.use(async (req, res, next) => {
    // If we are on Vercel and MONGO_URI is missing, throw a massive error so the user knows!
    if (!process.env.MONGO_URI && process.env.NODE_ENV !== 'development' && process.env.VERCEL) {
        return res.status(500).json({ 
            error: "CRITICAL VERCEL ERROR: You forgot to add MONGO_URI to your Vercel Environment Variables! The server is trying to connect to localhost, which is causing the timeout." 
        });
    }

    try {
        await connectToDatabase();
        next();
    } catch (err) {
        console.error("MongoDB Connection Error in middleware:", err);
        return res.status(500).json({
            error: `DATABASE CONNECTION FAILED: ${err.message}. Your MongoDB Atlas is blocking Vercel OR your MONGO_URI is incorrect.`
        });
    }
});

// ── DEBUG ENDPOINT: shows which env vars Vercel can see (no values exposed) ─
app.get('/api/debug-env', (req, res) => {
  res.json({
    JWT_SECRET:     !!process.env.JWT_SECRET   ? `✅ SET (length: ${process.env.JWT_SECRET.length})` : '❌ MISSING',
    MONGO_URI:      !!process.env.MONGO_URI     ? `✅ SET (length: ${process.env.MONGO_URI.length})`   : '❌ MISSING',
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY? `✅ SET` : '❌ MISSING',
    NODE_ENV:       process.env.NODE_ENV || '(not set)',
    VERCEL:         process.env.VERCEL   || '(not set)',
  });
});

app.use('/api/auth', authRoutes);

// dummy test
app.get("*", (req, res, next) => {
    if (req.path === '/' || req.path === '/api' || req.path === '/api/') {
        return res.send("Hello World! ChatSOL server is running. Path: " + req.path);
    }
    next();
});

// Protected chat route
app.post(["/", "/api", "/api/"], verifyToken, async (req, res) => {
    const { message, chat } = req.body;

    try {
        // Log chat activity
        await Activity.create({ userId: req.user.id, action: 'AI Chat Request', details: 'User interacted with AI' });

        // Build multi-modal history contents
        const contents = [];
        if (chat && Array.isArray(chat)) {
            chat.forEach(msg => {
                const role = msg.sender === 'user' ? 'user' : 'model';
                const parts = [];
                
                if (msg.message) {
                    parts.push({ text: msg.message });
                }
                
                if (msg.attachments && Array.isArray(msg.attachments)) {
                    msg.attachments.forEach(att => {
                        parts.push({
                            inlineData: {
                                mimeType: att.mimeType,
                                data: att.data // base64 string
                            }
                        });
                    });
                }
                
                if (parts.length > 0) {
                    contents.push({ role, parts });
                }
            });
        } else if (message) {
            contents.push({ role: 'user', parts: [{ text: message }] });
        }

        if (contents.length === 0) {
            return res.status(400).json({ error: "Empty prompt or history" });
        }

        const hasAttachments = contents.some(c => c.parts.some(p => p.inlineData));

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contents,
            config: {
                systemInstruction: `You are a helpful AI assistant. The current date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
                tools: hasAttachments ? [] : [{ googleSearch: {} }],
                maxOutputTokens: 2000,
                temperature: 0.5
            }
        });
        
        res.json({ message: response.text });

    } catch(e) {
        console.error("Gemini Error:", e);
        res.status(500).json({ error: e.message || "Failed to generate response" });
    }
});

// listening
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3080;
  app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
}

export default app;