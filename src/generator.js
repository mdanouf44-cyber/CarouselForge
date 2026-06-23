import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GEMINI_API_KEY && !process.env.NVIDIA_API_KEY && !process.env.HF_API_KEY) {
  console.warn('Warning: None of GEMINI_API_KEY, NVIDIA_API_KEY, or HF_API_KEY are defined in the environment variables.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Clean code blocks from JSON string if the model returns them
function cleanJsonString(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    // Strip leading ```json or ``` and trailing ```
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

// Prompt template used for both Gemini and NVIDIA NIM models
function buildSystemPrompt(story, timeSlot = 'am') {
  const isMorning = timeSlot === 'am';
  const slotDescription = isMorning 
    ? "AM (Morning Run): Write a deep-dive, reflective, and analytical LinkedIn post. Focus on a thorough summary of yesterday's tech/AI developments and what they mean for the industry. The tone should be highly professional, structured, and insightful."
    : "PM (Evening Run): Write a high-energy, breaking news LinkedIn post. Focus on immediate, exciting, and fast-paced daily highlights. The tone should be direct, engaging, and actionable, emphasizing what just happened today.";

  return `
You are a senior tech writer and LinkedIn branding expert.
Your job is to transform a trending tech/AI news story into:
1. A highly engaging, professional 5-slide LinkedIn carousel.
2. A high-converting LinkedIn post caption (the text copy) customized for the ${timeSlot.toUpperCase()} slot.

Here are the news story details:
Source: ${story.source || story.sources?.join(', ') || 'Tech Feeds'}
Title: ${story.title}
Link: ${story.url}
Summary details: ${story.summary}

Create content for exactly 5 slides and the accompanying LinkedIn post. The content must be structured as JSON matching this schema:

{
  "date": "YYYY-MM-DD", // Date of the news story or current date
  "linkedin_post": "An engaging, high-converting LinkedIn post caption (150-250 words) written in a professional branding voice. Follow these guidelines for the ${timeSlot.toUpperCase()} slot:\\n${slotDescription}\\n\\nStructure the post EXACTLY with:\\n- A scroll-stopping hook starting with an eye-catching emoji (e.g. 🚨 BREAKING: or 🚀 NEWS: or similar relevant emoji)\\n- A context paragraph summarizing the news (2-3 sentences)\\n- A bulleted takeaway header (e.g. Here's what matters: or Here is what you need to know:)\\n- Exactly 3 bulleted key takeaways, starting with •\\n- A concluding paragraph highlighting the industry impact or significance of this development\\n- A community question (e.g. Question for the community: ... or What are your thoughts on ...)\\n- Exactly 5 relevant tech hashtags (e.g. #AI #TechNews #OpenAI)",
  "slides": [
    {
      "slide_number": 1,
      "type": "intro",
      "headline": "Bold, scroll-stopping headline (max 8 words, strong hook, condensed style)",
      "subheadline": "Clear teaser of what they will learn (max 12 words)"
    },
    {
      "slide_number": 2,
      "type": "story",
      "title": "Brief Slide Title (e.g., The Announcement)",
      "content": "A single cohesive paragraph of 20-30 words summarizing what happened. Do not use bullets, numbers, or lists."
    },
    {
      "slide_number": 3,
      "type": "deep_dive",
      "title": "Brief Slide Title (e.g., How It Works)",
      "content": "A single cohesive paragraph of 20-30 words detailing the technical mechanics or key details. Do not use bullets, numbers, or lists."
    },
    {
      "slide_number": 4,
      "type": "impact",
      "title": "Brief Slide Title (e.g., The Future)",
      "content": "A single cohesive paragraph of 20-30 words explaining the industry impact or practical takeaways. Do not use bullets, numbers, or lists."
    },
    {
      "slide_number": 5,
      "type": "outro",
      "headline": "THANK YOU!",
      "subheadline": "Follow for daily AI & tech breakdowns. Share your thoughts in the comments!"
    }
  ]
}

Instructions:
1. Tone must be professional, insightful, and clear. Avoid generic hype words like "revolutionary", "game-changing", "groundbreaking", or "mind-blowing".
2. Keep slide text short and concise so it does not overflow when rendered on a square slide (1080x1080px).
3. The content must be factual and directly draw from the provided news story.
4. Each slide's text MUST NOT exceed 250 characters.
5. In the "linkedin_post" value, you MUST use double newlines (\\n\\n) to separate each logical paragraph/section and each bullet point. Do not bundle them into a single block or omit spaces. Use a clean, spaced-out layout matching this style:
   🚨 EMOJI HOOK...\\n\\nContext paragraph...\\n\\nHere's what matters:\\n\\n• Takeaway 1\\n\\n• Takeaway 2\\n\\n• Takeaway 3\\n\\nConcluding impact paragraph...\\n\\nCommunity question...\\n\\n#Hashtags
6. Provide raw JSON only.
`;
}

// Fetch completions from NVIDIA NIM (OpenAI compatible endpoint)
async function generateNvidiaContent(story, timeSlot) {
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct';
  
  console.log(`Generating AI carousel content via NVIDIA NIM API (Model: ${model}) for story: "${story.title}"`);
  const prompt = buildSystemPrompt(story, timeSlot);

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NVIDIA NIM API error: Status ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const text = result.choices[0].message.content;
  const cleanedText = cleanJsonString(text);
  return JSON.parse(cleanedText);
}

// Fetch completions from Google Gemini
async function generateGeminiContent(story, timeSlot) {
  console.log(`Generating AI carousel content via Gemini (Model: gemini-1.5-flash) for story: "${story.title}"`);
  
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined in the environment.');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    }
  });

  const prompt = buildSystemPrompt(story, timeSlot);
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleanedText = cleanJsonString(text);
  return JSON.parse(cleanedText);
}

// Fetch completions from Hugging Face Router API (OpenAI compatible endpoint)
async function generateHuggingFaceContent(story, timeSlot) {
  const apiKey = process.env.HF_API_KEY;
  const model = process.env.HF_MODEL || 'zai-org/GLM-5.2';
  
  console.log(`Generating AI carousel content via Hugging Face API (Model: ${model}) for story: "${story.title}"`);
  const prompt = buildSystemPrompt(story, timeSlot);

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(180000) // Hugging Face MoE might take longer, 3 minutes timeout
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hugging Face API error: Status ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const text = result.choices[0].message.content;
  const cleanedText = cleanJsonString(text);
  return JSON.parse(cleanedText);
}

// Main generation wrapper with fallback controls
export async function generateCarouselContent(story, timeSlot) {
  // If Hugging Face is configured, try it first
  if (process.env.HF_API_KEY) {
    try {
      return await generateHuggingFaceContent(story, timeSlot);
    } catch (error) {
      console.warn('Hugging Face API generation failed. Falling back to NVIDIA...', error.message);
    }
  }

  // If NVIDIA is configured, try it
  if (process.env.NVIDIA_API_KEY) {
    try {
      return await generateNvidiaContent(story, timeSlot);
    } catch (error) {
      console.warn('NVIDIA NIM API generation failed. Falling back to Gemini...', error.message);
    }
  }

  // Fallback to Gemini
  return await generateGeminiContent(story, timeSlot);
}
