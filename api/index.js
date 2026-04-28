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

const app = express();

app.use(cors({
  origin: true, // Allow all origins for Vercel dynamic URLs
  credentials: true
}));
app.use(bodyParser.json());

// Connect to MongoDB
const mongoUri = process.env.MONGO_URI;

if (!mongoUri && process.env.NODE_ENV !== 'development') {
  console.error("FATAL ERROR: MONGO_URI is missing. Please add it to your Vercel Environment Variables!");
}

mongoose.connect(mongoUri || "mongodb://localhost:27017/chatsol", {
  serverSelectionTimeoutMS: 3000, // Fail fast if DB is unreachable
  bufferCommands: false // Do not buffer commands if connection is down
})
.then(() => console.log("Connected to MongoDB Atlas"))
.catch((err) => console.log("MongoDB connection error (Check Vercel env vars & Atlas IP whitelist):", err.message));

// Configure Gemini API
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is missing from environment variables!");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Routes
app.use((req, res, next) => {
    // If we are on Vercel and MONGO_URI is missing, throw a massive error so the user knows!
    if (!process.env.MONGO_URI && process.env.NODE_ENV !== 'development' && process.env.VERCEL) {
        return res.status(500).json({ 
            error: "CRITICAL VERCEL ERROR: You forgot to add MONGO_URI to your Vercel Environment Variables! The server is trying to connect to localhost, which is causing the timeout." 
        });
    }
    next();
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
app.post("/", verifyToken, async (req, res) => {
    const { message } = req.body;

    try {
        // Log chat activity
        await Activity.create({ userId: req.user.id, action: 'AI Chat Request', details: 'User interacted with AI' });

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: message,
            config: {
                systemInstruction: `You are a helpful AI assistant. The current date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
                tools: [{ googleSearch: {} }],
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