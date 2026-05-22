import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { verifyToken } from '../middleware/auth.js';
import KnowledgeChunk from '../models/KnowledgeChunk.js';

const router = express.Router();

// Helper to chunk text with a sliding window
function chunkText(text, maxChunkSize = 800, overlap = 150) {
  if (!text || typeof text !== 'string') return [];
  
  // Clean up whitespace
  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  
  // Split into paragraphs first to keep logical separation
  const paragraphs = normalizedText.split('\n\n');
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // If a single paragraph is larger than the limit, chunk it by characters/words
    if (trimmedPara.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      let index = 0;
      while (index < trimmedPara.length) {
        const chunkContent = trimmedPara.substring(index, index + maxChunkSize);
        chunks.push(chunkContent.trim());
        index += (maxChunkSize - overlap);
      }
    } else if ((currentChunk + '\n\n' + trimmedPara).length > maxChunkSize) {
      // If adding this paragraph exceeds the limit, save current chunk and start a new one
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // Retain overlap if possible
      const lastWords = currentChunk.slice(-overlap);
      currentChunk = lastWords ? (lastWords + '\n\n' + trimmedPara) : trimmedPara;
    } else {
      // Append paragraph to the current chunk
      currentChunk = currentChunk ? (currentChunk + '\n\n' + trimmedPara) : trimmedPara;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 5); // Exclude trivial snippets
}

// ──────────────────────────────────────────────────────────
// POST /api/knowledge/upload
// Ingests file content or pasted text, chunks it, and indexes it.
// ──────────────────────────────────────────────────────────
router.post('/upload', verifyToken, async (req, res) => {
  try {
    const { filename, content } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    // text-embedding-004 lives on the stable v1 API, not the default v1beta.
    // We create a dedicated client for embeddings with apiVersion: 'v1'.
    const embeddingClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1',
    });

    // 1. Split content into logical chunks
    const textChunks = chunkText(content);
    if (textChunks.length === 0) {
      return res.status(400).json({ error: 'Content is too short or empty.' });
    }

    // Delete any existing chunks for this file under this user to support re-upload / updates
    await KnowledgeChunk.deleteMany({ userId: req.user.id, filename });

    // 2. Generate embeddings and save chunks
    const chunksToInsert = [];
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunkTextContent = textChunks[i];
      
      console.log(`🤖 Generating embedding for ${filename} [Chunk ${i + 1}/${textChunks.length}]`);
      
      const embedResponse = await embeddingClient.models.embedContent({
        model: 'text-embedding-004',
        contents: chunkTextContent,
      });

      if (!embedResponse?.embedding?.values) {
        throw new Error(`Failed to generate embedding for chunk ${i + 1}.`);
      }

      chunksToInsert.push({
        userId: req.user.id,
        filename,
        text: chunkTextContent,
        embedding: embedResponse.embedding.values,
      });
    }

    // Bulk insert into MongoDB
    await KnowledgeChunk.insertMany(chunksToInsert);
    
    console.log(`✅ Ingested ${filename}: created ${chunksToInsert.length} vector chunks.`);

    res.status(200).json({
      message: `Successfully ingested "${filename}" into knowledge base!`,
      chunksCount: chunksToInsert.length,
    });

  } catch (err) {
    console.error('❌ Error during document ingestion:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest document.' });
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/knowledge/documents
// Lists all unique uploaded documents and chunk counts for this user.
// ──────────────────────────────────────────────────────────
router.get('/documents', verifyToken, async (req, res) => {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    
    const documents = await KnowledgeChunk.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: '$filename',
          chunkCount: { $sum: 1 },
          createdAt: { $min: '$createdAt' },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    // Format output
    const formatted = documents.map(doc => ({
      filename: doc._id,
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt,
    }));

    res.status(200).json(formatted);
  } catch (err) {
    console.error('❌ Error listing documents:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch indexed documents.' });
  }
});

// ──────────────────────────────────────────────────────────
// DELETE /api/knowledge/documents/:filename
// Deletes a specific indexed document.
// ──────────────────────────────────────────────────────────
router.delete('/documents/:filename', verifyToken, async (req, res) => {
  try {
    const { filename } = req.params;

    const result = await KnowledgeChunk.deleteMany({
      userId: req.user.id,
      filename: filename,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Document not found or access denied.' });
    }

    console.log(`🗑️ Deleted ${result.deletedCount} chunks for "${filename}"`);

    res.status(200).json({
      message: `Successfully deleted "${filename}" from knowledge base.`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error('❌ Error deleting document:', err);
    res.status(500).json({ error: err.message || 'Failed to delete document.' });
  }
});

export default router;
