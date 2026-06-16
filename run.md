# Carousel Forge: Run & Setup Instructions

Carousel Forge is an automated LinkedIn Carousel curation system that scrapes trending AI/tech news, generates high-DPI square slides, creates engaging slot-specific LinkedIn post captions, and delivers them directly to a Telegram bot and web dashboard for curated approval.

---

## ⚙️ Prerequisites

Ensure you have the following installed on your system:
* **Node.js** (v18 or higher recommended)
* **Google Chrome** or **Microsoft Edge** (required by Puppeteer for slide screenshot generation)

---

## 🚀 Getting Started

### 1. Install Dependencies
Clone the repository, open a terminal in the project directory, and run:
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root of the project (copying from `.env.example` as a template) and configure your secrets:
```env
# API Keys
NVIDIA_API_KEY=your_nvidia_nim_key_here
NVIDIA_MODEL=minimaxai/minimax-m3

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Branding & Visual Customization
BRAND_HANDLE=www.linkedin.com/in/mohammad-anouf-saani
BRAND_AUTHOR_NAME=Mohammad Anouf Saani
BRAND_LOGO_TEXT=⚡
```

---

## 🛠️ Running the Application

Carousel Forge can be run in two different modes: **CLI Mode** (for one-off testing) or **Daemon Server Mode** (for scheduled daily runs, Telegram bot interactions, and the Web Curation Dashboard).

### Mode A: CLI Mode (One-Off Local Test)
Runs the scraper, calls the LLM, renders PNG images locally, and prints the generated LinkedIn post caption to the console.

* Run the **Morning (AM)** slot news scraper:
  ```bash
  node src/index.js am
  ```
* Run the **Evening (PM)** slot news scraper:
  ```bash
  node src/index.js pm
  ```
* Slide images will be generated inside the `dist/runs/run-{timestamp}/` folder.

### Mode B: Daemon Server & Dashboard Mode (Recommended)
Launches the background Telegram polling bot, active crons, and the Web Curation Dashboard.

* Start the server:
  ```bash
  npm start
  # or
  node src/server.js
  ```
* **Dashboard Access**: Open your browser and navigate to:  
  👉 **http://localhost:3000**
* **Time Zone Crons**: The daemon automatically triggers scraping & generation at:
  * **08:00 AM IST (Kolkata)**: Scrapes yesterday's news.
  * **08:00 PM IST (Kolkata)**: Scrapes today's trending tech highlights.

---

## 🤖 Telegram Bot Interface

Once the server is running, you can message your Telegram Bot:
* `/start` - Start the bot client.
* `/help` - View command guides.
* `/status` - Check server uptime, current IST time, and schedule status.
* `/history` - View the last 7 generated carousel logs and status entries.
* `/generate am` or `/generate pm` - Manually force-trigger slide generation for that timeslot.

### Curation Loop
1. When a run is triggered, the bot delivers the **5-slide album** and a copy-pasteable **LinkedIn post caption** as a monospace code block.
2. An inline keyboard will be sent below it:
   * **Approve**: Copies generated PNGs to `dist/approved/run-{id}/` and saves the run status.
   * **Regenerate**: Swaps content using the next highest-ranked news story/angle.
   * **Reject**: Wipes temporary files and registers the rejection.

---

## ☁️ Deployment

For 24/7 cloud hosting, this project is fully compatible with **Render** using the pre-configured [Dockerfile](file:///c:/Users/MOHAMMAD%20ANOUF%20SAANI/Desktop/c1/Dockerfile) and [render.yaml](file:///c:/Users/MOHAMMAD%20ANOUF%20SAANI/Desktop/c1/render.yaml) Blueprint.
* See the detailed guide **[render_deployment_guide.md](file:///C:/Users/MOHAMMAD%20ANOUF%20SAANI/.gemini/antigravity-ide/brain/1905eef3-67b9-4a77-97a7-b272fe1c2405/render_deployment_guide.md)** for step-by-step hosting instructions.
