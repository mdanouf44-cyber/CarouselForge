PRODUCT REQUIREMENTS DOCUMENT
AI/Tech Carousel Generator
+ Telegram Approval Bot
Automated LinkedIn Carousel Creation from Trending AI &amp; Tech News
Version
1.0 — Initial Release
Date
June 2026
Status
Draft — Pending Engineering Review
Owner
Product Owner
Audience
Full-Stack Developer, DevOps, Design
1. Executive Summary
What we are building and why
This document defines the full product requirements for an automated content system that discovers trending AI and Technology topics from Reddit, X (Twitter), and AI forums, generates visually polished 6-slide LinkedIn carousel images twice daily, and delivers them via a Telegram Bot for one-click human approval before publication.

### Problem Statement

Content creators and personal brands in the AI/Tech space face three compounding problems:
Manually tracking trending topics across Reddit, X, and niche AI forums is time-consuming (2–4 hours/day).
Converting raw news into visually designed carousel images requires design tools and significant effort.
Maintaining a twice-daily posting cadence on LinkedIn is unsustainable without automation.

### Our Solution

A fully automated pipeline that:
Scrapes and ranks trending AI/Tech content from multiple sources every morning and evening.
Generates a 6-image carousel (Intro → 4 Content Slides → Outro) using a consistent branded visual template.
Delivers the ready-to-post carousel to a Telegram Bot at 08:00 AM and 08:00 PM IST daily.
Requires only a single tap to approve the carousel before it is posted to LinkedIn.

### Content Schedule Logic

Delivery Time
Content Coverage
08:00 AM IST
Yesterday's top AI/Tech stories — retrospective and analysis
08:00 PM IST
Today's breaking AI/Tech stories — real-time trends
2. Goals &amp; Success Metrics

### Primary Goals

Reduce creator time spent on content research and design to under 5 minutes per carousel.
Achieve 100% on-time delivery of both scheduled carousel drops with zero manual intervention.
Maintain carousel visual quality consistent with LinkedIn best practices for engagement.
Enable a single-person creator to publish 14 high-quality carousels per week.

### Key Performance Indicators (KPIs)

Metric
Definition
Target
Delivery Reliability
Carousels sent on time (within ±5 min)
&gt; 99%
Approval Rate
% of carousels approved without editing
&gt; 80%
Content Freshness
Avg. age of news at delivery
&lt; 18 hours
Source Coverage
Unique sources scraped per run
≥ 5 sources
Image Render Time
Time to generate all 6 images
&lt; 90 seconds
Bot Uptime
Telegram bot availability
&gt; 99.5%
3. Scope
What is in and out of this version
In Scope (v1.0)
Out of Scope (Future)
Reddit, X, AI forums scraping
Auto-posting to LinkedIn (no approval)
6-slide carousel image generation
Instagram / Twitter carousels
Telegram Bot delivery &amp; approval
Video / Reel generation
08:00 AM and 08:00 PM IST schedules
Multi-language support
Branded visual template
Analytics dashboard for engagement
AM = yesterday / PM = today logic
Audience growth recommendations
Manual override / re-generate command
Paid content monetization
4. User Personas

### Primary User — The Creator

A solo AI/Tech content creator or personal brand builder on LinkedIn.
Posts carousels regularly but lacks time for daily research and design.
Wants control and final approval before anything goes live.
Comfortable with Telegram; uses it for quick decisions on mobile.

### Secondary User — The Admin/Developer

Sets up and maintains the pipeline (scraping, scheduling, rendering).
Monitors system health, handles API rate limits, and updates templates.
Needs clear logging, error alerts via Telegram, and simple config management.
5. System Architecture Overview
The system is composed of four major subsystems that run in a pipeline triggered by a scheduler twice daily:

### 5.1  Content Intelligence Engine (Scraper + Ranker)

Responsible for discovering and ranking the top 5 content angles for each carousel.
Sources: Reddit (r/MachineLearning, r/artificial, r/ChatGPT, r/LocalLLaMA, r/technology), X/Twitter trending AI hashtags, Hacker News, AI newsletters (e.g. TLDR AI), and niche forums (e.g. LessWrong, Hugging Face community).
Ranking algorithm considers: engagement velocity (upvotes/retweets per hour), recency, topic novelty vs. prior carousels, and cross-source signal strength.
Outputs: a ranked JSON list of 5 content angles — each with title, summary, key stats/quotes, source URLs, and suggested hook.
AM run: scrapes content published in the previous calendar day (yesterday 00:00–23:59 IST).
PM run: scrapes content published since midnight of the current day (today 00:00 until run time).

### 5.2  Carousel Generation Engine (AI Writer + Image Renderer)

Takes the top content angle (or top 4 for middle slides) and produces 6 final PNG images.

#### Slide Structure

Slide
Purpose
Content
Slide 1 — Intro
Hook the audience
Bold headline, subheadline, brand handle, date
Slide 2 — Story
Set context
What happened &amp; why it matters (150–180 words)
Slide 3 — Deep Dive
Core insight
Key data points, quotes, visual stat callouts
Slide 4 — Impact
So what?
Industry impact, who is affected, opportunity angle
Slide 5 — Action
Takeaway
3–5 bullet actionable insights or predictions
Slide 6 — Outro
CTA + Brand
Follow prompt, next carousel tease, brand logo

#### Rendering Stack

AI Writing: Claude API (claude-sonnet-4-6) — generates slide copy from ranked content data.
Image Generation: HTML/CSS template rendered via Puppeteer (headless Chrome) → exported as 1080×1080 PNG.
Typography: Inter / DM Sans (Google Fonts) for modern LinkedIn aesthetics.
Color Scheme: Configurable brand palette (default: dark background with vibrant accent).

### 5.3  Telegram Bot (Approval Interface)

The single point of human interaction in the pipeline. Built using the Telegram Bot API (node-telegram-bot-api or python-telegram-bot).
On carousel ready: Bot sends all 6 images as a media group to the creator's private chat, followed by an inline keyboard with three actions.
✅  Approve — marks carousel as approved, queues for download/LinkedIn post.
🔄  Regenerate — triggers a re-run of the AI writer with a different content angle.
❌  Reject — discards the carousel and logs feedback for template improvement.
Error alerts: If the pipeline fails, the Bot sends a diagnostic message with the error type and timestamp.
Manual trigger command: /generate am or /generate pm — allows the creator to manually request a fresh carousel at any time.
Status command: /status — returns last run time, next scheduled run, and approval queue.

### 5.4  Scheduler &amp; Orchestrator

Primary scheduler: node-cron or APScheduler (Python) with cron expressions 0 8 * * * and 0 20 * * *.
Timezone: All schedules operate in Asia/Kolkata (IST, UTC+5:30).
Orchestrator manages the sequential pipeline: scrape → rank → write → render → send to Telegram.
Retry logic: on any stage failure, retry up to 3 times with exponential backoff before alerting via Telegram.
6. Detailed Functional Requirements

### FR-01  Content Scraping

FR-01.1: System MUST scrape at minimum Reddit, X/Twitter, and one AI-specific forum per run.
FR-01.2: System MUST apply date filters to enforce AM = yesterday / PM = today content boundaries.
FR-01.3: System MUST deduplicate content across sources using URL hashing and semantic similarity.
FR-01.4: System MUST respect API rate limits and implement exponential backoff on 429 responses.
FR-01.5: System MUST maintain a content cache to prevent duplicate carousels across consecutive runs.

### FR-02  Content Ranking

FR-02.1: System MUST output exactly 5 ranked content angles per run in JSON format.
FR-02.2: Ranking MUST factor in: upvote/retweet velocity, cross-source mentions, comment sentiment, and recency.
FR-02.3: System MUST exclude topics already used in the past 48 hours.
FR-02.4: Ranked list MUST include for each angle: title, summary (≤100 words), top 3 source URLs, and a suggested hook line.

### FR-03  AI Copywriting

FR-03.1: System MUST generate copy for all 6 slides using the top-ranked content angle.
FR-03.2: Intro slide MUST contain a hook headline (≤12 words), a subheadline (≤20 words), and a date stamp.
FR-03.3: Middle slides (2–5) MUST follow the Story → Deep Dive → Impact → Action structure.
FR-03.4: Outro slide MUST include a CTA to follow, a teaser for the next post, and a brand handle placeholder.
FR-03.5: Total word count across all slides MUST NOT exceed 600 words.
FR-03.6: Copy MUST be written for a professional LinkedIn audience (no slang, no excessive emojis).

### FR-04  Image Rendering

FR-04.1: System MUST render exactly 6 PNG images per carousel at 1080×1080 pixels.
FR-04.2: All images MUST use a consistent branded template (configurable colors, fonts, logo).
FR-04.3: Slide 1 MUST visually differentiate from slides 2–5 (e.g., full-bleed background, large headline).
FR-04.4: Slide 6 MUST display a brand logo, handle, and CTA in a distinct outro layout.
FR-04.5: System MUST complete rendering of all 6 images in under 90 seconds.
FR-04.6: Images MUST embed slide number indicators (1/6, 2/6 … 6/6) in a consistent position.

### FR-05  Telegram Bot

FR-05.1: Bot MUST send 6 images as a Telegram media group (album) in a single message.
FR-05.2: Bot MUST attach an inline keyboard with Approve, Regenerate, and Reject buttons below the album.
FR-05.3: Bot MUST respond to button presses within 3 seconds with a confirmation message.
FR-05.4: Approved carousels MUST be saved to a designated output folder with metadata (date, time slot, topic).
FR-05.5: Bot MUST support /generate, /status, /history, and /help commands.
FR-05.6: Bot MUST send a failure alert if any pipeline stage fails, including stage name and error summary.

### FR-06  Scheduling

FR-06.1: System MUST trigger the full pipeline automatically at 08:00 AM IST and 08:00 PM IST every day.
FR-06.2: System MUST handle daylight saving edge cases gracefully (IST is UTC+5:30, no DST).
FR-06.3: System MUST log every scheduled run with start time, end time, and success/failure status.
7. Non-Functional Requirements
Requirement
Specification
Priority
Pipeline Latency
Full pipeline (scrape → send) &lt; 8 minutes
P0
Image Quality
PNG ≥ 150 DPI, file size &lt; 2 MB each
P0
Bot Availability
≥ 99.5% uptime (&lt; 44 min downtime/month)
P0
API Security
All API keys stored in environment variables, never in code
P0
Error Recovery
Automatic retry ×3 before Telegram failure alert
P1
Scalability
Architecture supports 4 runs/day with no code changes
P1
Observability
Structured JSON logs for every pipeline stage
P1
Cost Efficiency
Monthly infra cost &lt; $30 USD at 60 carousels/month
P2
Portability
Deployable via Docker Compose on any Linux VPS
P2
8. API &amp; External Integrations
Service
Purpose
Notes
Reddit API (PRAW)
Scrape subreddit hot/new posts
Free tier — 100 req/min
X/Twitter API v2
Trending AI hashtags, top tweets
Basic tier needed (~$100/mo) or scrape via Nitter
Anthropic Claude API
AI copywriting for slide content
claude-sonnet-4-6 model
Telegram Bot API
Deliver images, handle approvals
Free — BotFather token required
Puppeteer / Playwright
HTML→PNG image rendering
Self-hosted, no cost
Google Fonts CDN
Inter / DM Sans typography
Free — needs network access
Hacker News API
Supplemental trending stories
Free, no auth required
Note on X/Twitter: Due to API costs, the team should evaluate Nitter (open-source Twitter frontend) or RapidAPI Twitter scrapers as a cost-effective alternative to the official API.
9. Carousel Visual Design Specification

### Canvas &amp; Layout

Canvas size: 1080 × 1080 px (square, optimized for LinkedIn carousel format).
Safe zone: 60 px padding on all sides — no text or logos outside this boundary.
Grid: 12-column grid with 20 px gutters for internal layout alignment.

### Slide Templates

Slide
Background
Key Elements
Slide 1 — Intro
Full dark gradient or hero image with overlay
Large headline, subheadline, date, brand handle, slide counter
Slides 2–5 — Content
Light/neutral with accent card elements
Section label, body copy, stat callout boxes, source citation, counter
Slide 6 — Outro
Brand color background
CTA text, brand logo, handle, teaser line, social icons

### Typography

Primary font: DM Sans — headlines (Bold, 64–80 px on Slide 1; 40–52 px on content slides).
Body font: Inter — body copy (Regular, 28–34 px), captions (Light, 22 px).
Line height: 1.35× for headlines, 1.6× for body copy.
Max characters per slide: 280 characters (enforced by AI writer prompt).

### Brand Tokens (Configurable)

Token
Default Value
Primary Background
#0F0F1A (near-black)
Accent Color
#6366F1 (indigo)
Secondary Accent
#EC4899 (pink/magenta)
Text Primary
#F9FAFB (off-white)
Text Secondary
#9CA3AF (gray)
Card Background
#1E1E2E
Brand Handle
@YourHandle (configurable)
10. Data Flow &amp; Pipeline Stages
The pipeline runs sequentially. Each stage must complete before the next begins. The orchestrator manages state and handles retries.
Stage
Input
Output
1. Trigger
Cron job (08:00 / 20:00 IST)
Pipeline context (am/pm, date)
2. Scrape
Source URLs + date filter
Raw post list (JSON)
3. Rank
Raw posts + engagement data
Top 5 ranked angles (JSON)
4. Write
Top angle + slide structure
6-slide copy (JSON)
5. Render
Slide copy + HTML template
6 PNG images (1080×1080)
6. Deliver
Images + Telegram Bot API
Media group message + buttons
7. Approve
Creator tap → Approve/Regenerate/Reject
Approved images in output folder
11. Recommended Technical Stack
Layer
Technology
Runtime
Node.js 20 LTS (primary) or Python 3.11
Scheduler
node-cron (Node) or APScheduler (Python)
Web Scraping
Playwright / Puppeteer + Cheerio (Reddit HTML fallback)
Reddit API
PRAW (Python) or snoowrap (Node)
AI Copywriting
Anthropic SDK — claude-sonnet-4-6
Image Rendering
Puppeteer headless Chrome → PNG export
Telegram Bot
node-telegram-bot-api or python-telegram-bot
Storage
Local filesystem (images), SQLite (run history/cache)
Config Management
dotenv (.env file) — never commit keys
Containerization
Docker + Docker Compose
Hosting
Any Linux VPS (DigitalOcean, Hetzner, Railway)
Logging
Winston (Node) or Loguru (Python) → JSON structured logs
12. Phased Implementation Plan

### Phase 1 — Foundation (Week 1–2)

Set up project repo, Docker Compose environment, and .env config structure.
Implement Reddit + Hacker News scraping with date filters and deduplication.
Build ranking algorithm (engagement velocity scoring).
Integrate Claude API for basic slide copy generation.
Unit tests for scraper and ranker modules.

### Phase 2 — Rendering (Week 3)

Design HTML/CSS templates for all 6 slide types.
Implement Puppeteer-based rendering pipeline (HTML → 1080×1080 PNG).
Integrate brand token system (colors, fonts, handle configurable via .env).
Visual QA pass against LinkedIn carousel best practices.

### Phase 3 — Telegram Bot (Week 4)

Build Telegram Bot with media group delivery, inline keyboard, and command handlers.
Wire up Approve → save to output folder, Regenerate → re-run writer with angle #2, Reject → log.
Implement error alerting via Bot on pipeline failures.
End-to-end integration test of full pipeline (scrape → approve).

### Phase 4 — Scheduling &amp; Hardening (Week 5)

Implement cron scheduler with IST timezone (08:00 and 20:00).
Add retry logic (×3 exponential backoff) for each pipeline stage.
Add /status, /history, /help Telegram commands.
Add X/Twitter source (official API or Nitter fallback).
Production deployment to VPS, smoke test both daily runs.

### Phase 5 — Polish &amp; Monitoring (Week 6)

Structured JSON logging for all pipeline stages.
Run history dashboard (SQLite-backed, viewable via /history command).
Template customization documentation for creator.
Performance optimization: target &lt; 6-minute total pipeline time.
13. Risks &amp; Mitigations
Risk
Impact
Mitigation
X/Twitter API cost ($100+/mo)
High
Use Nitter or RapidAPI scraper as fallback; Reddit + HN sufficient for v1
Reddit API rate limiting
Medium
Implement backoff, cache results, use official OAuth app credentials
Claude API latency spikes
Medium
Set 30-second timeout; retry once; fall back to previous run's copy
Puppeteer render failure
High
Pre-warm Chrome instance; health-check before scheduled run
Telegram delivery failure
High
Retry ×3; save images locally; alert via secondary channel (email)
Content repetition (same topic daily)
Medium
48-hour topic cache with semantic similarity check
VPS downtime at scheduled time
High
Use a reliable VPS provider; add cron health-check ping (UptimeRobot)
Brand/copyright issues in scraped content
Low
Always cite sources; use summaries not verbatim quotes in slides
14. Open Questions
Q1: Should the creator be able to edit individual slide copy via Telegram before approving, or is the approve/regenerate binary sufficient for v1?
Q2: Will X/Twitter access be via the official API (Basic $100/mo) or a third-party scraper? This affects data freshness and reliability.
Q3: What is the preferred hosting environment — personal VPS, Railway, or a cloud provider like AWS?
Q4: Should the system support multiple brand templates (e.g., a light mode and dark mode variant) selectable per run?
Q5: Is there a preferred LinkedIn posting tool for Phase 2 auto-posting, or will posting always remain manual?
Q6: Should the Telegram approval flow also include a preview of the carousel headline text for quick scanning before viewing all 6 images?
15. Appendix

### A. Telegram Bot Command Reference

Command
Description
Response
/generate am
Manually trigger morning carousel
Starts pipeline for yesterday's content
/generate pm
Manually trigger evening carousel
Starts pipeline for today's content
/status
Check system status
Last run, next run, approval queue count
/history
View last 7 carousels
List of date, topic, and approval status
/help
Show command list
Full command reference message

### B. Content Sources Reference

Source
Type
Endpoint / Method
r/MachineLearning
Reddit
PRAW subreddit.hot(limit=25)
r/artificial
Reddit
PRAW subreddit.hot(limit=25)
r/ChatGPT
Reddit
PRAW subreddit.hot(limit=25)
r/LocalLLaMA
Reddit
PRAW subreddit.hot(limit=25)
r/technology
Reddit
PRAW subreddit.hot(limit=15)
Hacker News
API
https://hacker-news.firebaseio.com/v0/topstories
X — #AI, #GenAI, #LLM
X API v2 or Nitter
Search recent tweets, sort by engagement
TLDR AI Newsletter
Web Scrape
Puppeteer → tldr.tech/ai

### C. Glossary

Carousel: A multi-image LinkedIn post format (up to 10 images) displayed as a swipeable slideshow.
Content Angle: A specific narrative framing of a trending topic suitable for a single carousel.
Engagement Velocity: The rate of upvotes, comments, or retweets per unit time — used as a proxy for trending momentum.
Inline Keyboard: Telegram's button interface displayed below a message for quick user interaction.
Pipeline: The end-to-end sequence of automated stages from content scraping to Telegram delivery.
Render: The process of converting HTML/CSS slide templates to PNG image files via headless browser.
IST: Indian Standard Time — UTC+5:30, no daylight saving adjustments.
End of Document  —  AI/Tech Carousel Generator PRD v1.0