import Parser from 'rss-parser';
import axios from 'axios';
import { readDb } from './db.js';

const parser = new Parser();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper to calculate similarity between two titles (Jaccard similarity of token sets)
function getTitleSimilarity(title1, title2) {
  const clean = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const words1 = new Set(clean(title1));
  const words2 = new Set(clean(title2));
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  const union = new Set([...words1, ...words2]).size;
  return intersection / union;
}

// Check if a topic was used in the last 48 hours
function isRecentDuplicate(title, history) {
  const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
  
  for (const entry of history) {
    if (entry.timestamp > fortyEightHoursAgo && entry.status === 'approved' && entry.angle) {
      if (getTitleSimilarity(title, entry.angle.title) > 0.45) {
        return true;
      }
    }
  }
  return false;
}

// Timezone boundaries helper
export function getIstBoundaries(timeSlot) {
  const nowUtc = new Date();
  
  // Format current UTC time into Asia/Kolkata fields
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric' };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(nowUtc);
  
  const getPart = name => parseInt(parts.find(p => p.type === name).value, 10);
  const istYear = getPart('year');
  const istMonth = getPart('month') - 1; // Date.UTC month is 0-indexed
  const istDay = getPart('day');
  
  // Helper to convert nominal IST time to absolute UTC epoch ms
  const getAbsoluteMsFromIst = (y, m, d, hr, min, sec) => {
    const nominalUtc = Date.UTC(y, m, d, hr, min, sec);
    return nominalUtc - (5.5 * 3600000); // Subtract 5.5 hours to align with IST
  };

  const currentIstDayDate = new Date(Date.UTC(istYear, istMonth, istDay));
  
  // Yesterday Date
  const yesterdayIstDayDate = new Date(currentIstDayDate);
  yesterdayIstDayDate.setUTCDate(currentIstDayDate.getUTCDate() - 1);
  const yesterdayYear = yesterdayIstDayDate.getUTCFullYear();
  const yesterdayMonth = yesterdayIstDayDate.getUTCMonth();
  const yesterdayDay = yesterdayIstDayDate.getUTCDate();

  let startEpochMs, endEpochMs;
  
  if (timeSlot === 'am') {
    startEpochMs = getAbsoluteMsFromIst(yesterdayYear, yesterdayMonth, yesterdayDay, 0, 0, 0);
    endEpochMs = getAbsoluteMsFromIst(yesterdayYear, yesterdayMonth, yesterdayDay, 23, 59, 59);
  } else {
    // pm
    startEpochMs = getAbsoluteMsFromIst(istYear, istMonth, istDay, 0, 0, 0);
    endEpochMs = nowUtc.getTime(); // up to current execution time
  }

  return { startEpochMs, endEpochMs };
}

// Resilient Fetch with Exponential Backoff
async function fetchWithBackoff(url, headers, maxRetries = 2, initialDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 200) {
        return res;
      }
      
      if (res.status === 429 && attempt < maxRetries) {
        const backoffTime = initialDelay * Math.pow(2, attempt);
        console.warn(`Hit 429 on ${url}. Retrying in ${backoffTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await delay(backoffTime);
        continue;
      }
      
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        const backoffTime = initialDelay * Math.pow(2, attempt);
        console.warn(`Error on ${url}: ${err.message}. Retrying in ${backoffTime}ms...`);
        await delay(backoffTime);
      } else {
        throw err;
      }
    }
  }
}

// Fetch Hacker News Top Stories
async function fetchHackerNews(startEpochMs, endEpochMs) {
  console.log('Fetching Hacker News...');
  try {
    const topIdsRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    const top50Ids = topIdsRes.data.slice(0, 50); // Fetch a wider list to find matches within timezone
    
    const stories = [];
    for (const id of top50Ids) {
      try {
        const itemRes = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const data = itemRes.data;
        if (data && data.title && data.time) {
          const publishedAt = data.time * 1000;
          if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
            stories.push({
              title: data.title,
              url: data.url || `https://news.ycombinator.com/item?id=${id}`,
              score: data.score || 0,
              comments: data.descendants || 0,
              source: 'Hacker News',
              summary: data.text || '',
              publishedAt
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch HN item ${id}:`, err.message);
      }
    }
    return stories;
  } catch (error) {
    console.error('Error fetching Hacker News:', error.message);
    return [];
  }
}

// Fetch Reddit Subreddit Hot Posts via Atom/RSS (Bypasses 403 data-center blocks)
async function fetchRedditSubreddit(subreddit, startEpochMs, endEpochMs) {
  console.log(`Fetching r/${subreddit} via RSS...`);
  const url = `https://www.reddit.com/r/${subreddit}/hot.rss`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    const res = await fetchWithBackoff(url, headers);
    if (!res || res.status !== 200) {
      console.warn(`Failed to fetch r/${subreddit} RSS (graceful fallback): Status ${res ? res.status : 'unknown'}`);
      return [];
    }
    
    const xmlText = await res.text();
    const feed = await parser.parseString(xmlText);
    const stories = [];
    
    feed.items.forEach((item, index) => {
      const pubDate = item.isoDate || item.pubDate;
      if (!pubDate) return;
      const publishedAt = new Date(pubDate).getTime();
      
      if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
        // Synthesize score and comments based on hotness rank in feed (0 to items.length - 1)
        const totalItems = feed.items.length;
        const rankMultiplier = totalItems - index;
        const score = rankMultiplier * 40;
        const comments = rankMultiplier * 5;

        stories.push({
          title: item.title,
          url: item.link,
          score,
          comments,
          source: `r/${subreddit}`,
          summary: item.contentSnippet || '',
          publishedAt
        });
      }
    });
    
    return stories;
  } catch (error) {
    console.error(`Error fetching r/${subreddit} RSS (graceful fallback):`, error.message);
    return [];
  }
}

// Fetch Generic Public Tech RSS Feeds
async function fetchPublicRss(name, url, startEpochMs, endEpochMs) {
  console.log(`Fetching ${name} RSS...`);
  try {
    const feed = await parser.parseURL(url);
    const stories = [];
    
    for (const item of feed.items) {
      const pubDate = item.isoDate || item.pubDate;
      if (!pubDate) continue;
      const publishedAt = new Date(pubDate).getTime();
      
      if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
        stories.push({
          title: item.title,
          url: item.link,
          score: 40, // Base default score weight
          comments: 5,
          source: name,
          summary: item.contentSnippet || item.content || '',
          publishedAt
        });
      }
    }
    return stories;
  } catch (error) {
    console.error(`Error fetching ${name} RSS:`, error.message);
    return [];
  }
}

// Fetch Hugging Face Daily Papers (API returns JSON)
async function fetchHuggingFaceDailyPapers(startEpochMs, endEpochMs) {
  console.log('Fetching Hugging Face Daily Papers...');
  try {
    const res = await fetch('https://huggingface.co/api/daily_papers');
    if (!res || res.status !== 200) {
      console.warn(`Failed to fetch Hugging Face papers: Status ${res ? res.status : 'unknown'}`);
      return [];
    }
    const data = await res.json();
    const stories = [];

    data.forEach(item => {
      if (!item.paper || !item.paper.publishedAt) return;
      const publishedAt = new Date(item.paper.publishedAt).getTime();
      
      if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
        // Boost scores for Hugging Face daily papers based on upvotes
        const score = (item.paper.upvotes || 0) * 45 + 100;
        const comments = item.paper.numComments || 0;
        
        stories.push({
          title: item.paper.title,
          url: `https://huggingface.co/papers/${item.paper.id}`,
          score,
          comments,
          source: 'Hugging Face',
          summary: item.paper.summary || item.paper.ai_summary || '',
          publishedAt
        });
      }
    });

    return stories;
  } catch (error) {
    console.error('Error fetching Hugging Face daily papers:', error.message);
    return [];
  }
}

// Fetch OpenAI Developer Forum Latest Posts
async function fetchOpenAiForum(startEpochMs, endEpochMs) {
  console.log('Fetching OpenAI Developer Forum...');
  const url = 'https://community.openai.com/posts.rss';
  try {
    const res = await fetchWithBackoff(url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    if (!res || res.status !== 200) {
      console.warn(`Failed to fetch OpenAI Forum RSS: Status ${res ? res.status : 'unknown'}`);
      return [];
    }
    
    const xmlText = await res.text();
    const feed = await parser.parseString(xmlText);
    const stories = [];
    
    feed.items.forEach(item => {
      const pubDate = item.isoDate || item.pubDate;
      if (!pubDate) return;
      const publishedAt = new Date(pubDate).getTime();
      
      if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
        stories.push({
          title: item.title,
          url: item.link,
          score: 80, // Default weight
          comments: 2,
          source: 'OpenAI Forum',
          summary: item.contentSnippet || '',
          publishedAt
        });
      }
    });
    
    return stories;
  } catch (error) {
    console.error('Error fetching OpenAI Forum RSS:', error.message);
    return [];
  }
}

// Fetch X/Twitter Trends via Google News RSS Search
async function fetchTwitterXSearch(startEpochMs, endEpochMs) {
  console.log('Fetching X/Twitter trending discussions...');
  const query = 'site:x.com OR site:twitter.com "AI" "workflow" OR "agent" OR "tool" OR "setup"';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  
  try {
    const res = await fetchWithBackoff(url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    if (!res || res.status !== 200) {
      console.warn(`Failed to fetch X/Twitter search RSS: Status ${res ? res.status : 'unknown'}`);
      return [];
    }
    
    const xmlText = await res.text();
    const feed = await parser.parseString(xmlText);
    const stories = [];
    
    feed.items.forEach(item => {
      const pubDate = item.isoDate || item.pubDate;
      if (!pubDate) return;
      const publishedAt = new Date(pubDate).getTime();
      
      if (publishedAt >= startEpochMs && publishedAt <= endEpochMs) {
        // Strip trailing source name like " - x.com" or " - twitter.com"
        const cleanedTitle = item.title
          .replace(/\s+-\s+x\.com$/i, '')
          .replace(/\s+-\s+twitter\.com$/i, '')
          .replace(/\s+-\s+@\w+$/i, '')
          .trim();

        stories.push({
          title: cleanedTitle,
          url: item.link,
          score: 120, // Default weight for Twitter search
          comments: 4,
          source: 'X (Twitter)',
          summary: item.contentSnippet || '',
          publishedAt
        });
      }
    });
    
    return stories;
  } catch (error) {
    console.error('Error crawling X/Twitter RSS search:', error.message);
    return [];
  }
}

// Main Scrape and Rank Entry Point
export async function scrapeTrending(timeSlot) {
  // If not provided, calculate time slot based on current Asia/Kolkata hour
  if (!timeSlot) {
    const nowUtc = new Date();
    const formatterHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
    const currentIstHour = parseInt(formatterHour.format(nowUtc), 10);
    timeSlot = currentIstHour < 14 ? 'am' : 'pm';
  }
  
  console.log(`Starting content scraping for slot: ${timeSlot.toUpperCase()}`);
  const { startEpochMs, endEpochMs } = getIstBoundaries(timeSlot);
  console.log(`Time window (IST): ${new Date(startEpochMs).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} to ${new Date(endEpochMs).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`);

  // Start sequential fetching for Reddit subreddits to prevent CDN 429 rate limiting
  const redditStories = [];
  const subreddits = ['MachineLearning', 'artificial', 'ChatGPT', 'LocalLLaMA', 'technology'];
  
  for (const sub of subreddits) {
    const stories = await fetchRedditSubreddit(sub, startEpochMs, endEpochMs);
    redditStories.push(...stories);
    // 1.5-second delay between requests to be extra safe
    await delay(1500);
  }

  // Start remaining parallel fetches
  const hnPromise = fetchHackerNews(startEpochMs, endEpochMs);
  const hfPromise = fetchHuggingFaceDailyPapers(startEpochMs, endEpochMs);
  const oaiPromise = fetchOpenAiForum(startEpochMs, endEpochMs);
  const twPromise = fetchTwitterXSearch(startEpochMs, endEpochMs);
  
  const rssFeeds = [
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
    { name: 'Wired Tech', url: 'https://www.wired.com/feed/category/gear/latest/rss' }
  ];
  const rssPromises = rssFeeds.map(feed => fetchPublicRss(feed.name, feed.url, startEpochMs, endEpochMs));
  
  const results = await Promise.all([
    hnPromise,
    hfPromise,
    oaiPromise,
    twPromise,
    ...rssPromises
  ]);
  let allStories = [...redditStories, ...results.flat()];
  console.log(`Fetched raw count: ${allStories.length} stories`);

  // Deduplicate and filter out recent historical duplicates
  const db = await readDb();
  const seenUrls = new Set();
  const uniqueStories = [];
  
  // First pass: exact URL match
  for (const story of allStories) {
    if (!story.url || !story.title) continue;
    const urlKey = story.url.toLowerCase().trim();
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);
    
    // Check if it is similar to any stories we already picked in this run
    let isDuplicateInRun = false;
    for (const unique of uniqueStories) {
      if (getTitleSimilarity(story.title, unique.title) > 0.45) {
        isDuplicateInRun = true;
        // Merge scores if it's the same topic across different sources
        unique.score += story.score;
        unique.comments += story.comments;
        unique.crossMentions = (unique.crossMentions || 1) + 1;
        unique.sources = unique.sources || [unique.source];
        if (!unique.sources.includes(story.source)) {
          unique.sources.push(story.source);
        }
        break;
      }
    }
    
    if (!isDuplicateInRun) {
      // Check history (48 hours duplicate check)
      if (isRecentDuplicate(story.title, db.history)) {
        continue;
      }
      uniqueStories.push({
        ...story,
        crossMentions: 1,
        sources: [story.source]
      });
    }
  }

  // Calculate ranking score
  const now = Date.now();
  uniqueStories.forEach(story => {
    let sourceWeight = 1.0;
    
    if (story.source === 'Hacker News') {
      sourceWeight = 1.4;
    } else if (story.source === 'Hugging Face') {
      sourceWeight = 1.6; // High priority for Hugging Face daily papers
    } else if (story.source === 'X (Twitter)') {
      sourceWeight = 1.5; // High priority for X/Twitter trends
    } else if (story.source === 'OpenAI Forum') {
      sourceWeight = 1.3;
    } else if (story.source.startsWith('r/')) {
      if (story.source === 'r/LocalLLaMA') {
        sourceWeight = 1.6; // Heavily weight local LLM workflows
      } else if (story.source === 'r/MachineLearning') {
        sourceWeight = 1.3;
      } else {
        sourceWeight = 1.2;
      }
    }

    // Engagement velocity calculation
    const rawEngagement = story.score + story.comments * 2;
    const ageHours = Math.max(0.5, (now - story.publishedAt) / 3600000);
    
    // Decay factor (recency): half life of ~24 hours
    const recencyFactor = Math.exp(-ageHours / 24);
    
    // Cross-source mention boost (1.5x for appearing in multiple sources)
    const crossSourceBoost = story.crossMentions > 1 ? 1.5 : 1.0;

    let rankingScore = rawEngagement * recencyFactor * sourceWeight * crossSourceBoost;

    // AI WORKFLOW VELOCITY MULTIPLIERS
    const workflowKeywords = [
      'workflow', 'agent', 'rag', 'chain', 'prompt', 'llama', 'ollama', 
      'local llm', 'run local', 'crewai', 'autogen', 'comfyui', 'fine-tune', 
      'pipeline', 'github', 'open-source', 'tool', 'api', 'vllm', 'setup', 
      'guide', 'tutorial', 'integrate', 'embedding', 'mcp'
    ];
    
    const penaltyKeywords = [
      'stock', 'shares', 'acquisition', 'buyout', 'lawsuit', 'sue', 
      'legal', 'layoff', 'fired', 'quarterly', 'earnings', 'revenue', 
      'financial', 'antitrust', 'ban', 'ceo', 'board member', 'regulation', 'policy'
    ];

    const titleAndDesc = (story.title + ' ' + story.summary).toLowerCase();
    
    // Check for workflow keywords
    const matchesWorkflow = workflowKeywords.some(keyword => titleAndDesc.includes(keyword));
    if (matchesWorkflow) {
      rankingScore *= 2.5; // Boost workflows!
    }

    // Check for corporate/legal penalties
    const matchesPenalty = penaltyKeywords.some(keyword => titleAndDesc.includes(keyword));
    if (matchesPenalty) {
      rankingScore *= 0.2; // Heavily penalize corporate gossip/news
    }

    story.rankingScore = rankingScore;
    story.isWorkflow = matchesWorkflow;
  });

  // Sort descending by score
  uniqueStories.sort((a, b) => b.rankingScore - a.rankingScore);

  // Return top 5 ranked story angles
  const topStories = uniqueStories.slice(0, 5);
  console.log(`Found ${topStories.length} ranked stories after filtering and deduplication:`);
  topStories.forEach((s, i) => {
    console.log(`[${i+1}] [${s.sources.join(', ')}] ${s.title} (Score: ${s.rankingScore.toFixed(1)}, Age: ${((now - s.publishedAt)/3600000).toFixed(1)}h)`);
  });

  return topStories;
}
