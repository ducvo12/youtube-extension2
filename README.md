# YouTube Contextual Language Learning Assistant

A Chrome extension that turns YouTube videos into interactive language-learning experiences. It adds a sidebar beside the video where learners can follow captions in real time, translate selected phrases with a learning-focused breakdown, and ask an AI assistant about vocabulary, grammar, slang, or tone without leaving YouTube.

The project is designed for intermediate-to-advanced learners using native video content. It is currently an unpublished work in progress and can be installed locally as an unpacked Chrome extension.

## Features

- Displays the active caption and recent lines in sync with video playback.
- Supports selecting from the caption tracks available for a video.
- Lets users highlight words or phrases from the transcript and translate them into English.
- Breaks translated text into meaningful chunks with definitions and grammer rules.
- Provides an AI chat informed by the video title, nearby transcript, selected caption, and recent conversation.
- Pauses transcript during ads and resumes them when the video resumes.
- Includes request diagnostics tab for inspecting backend latency and errors during development.

## Tech Stack

### Chrome extension

- JavaScript
- HTML and CSS rendered through the content script
- Chrome Extension APIs and Manifest V3
- esbuild for bundling content, background, and page-context scripts

### Backend

- Python 3.10+
- FastAPI and Pydantic
- Uvicorn
- Google Gemini API via the Google Gen AI SDK
- python-dotenv for local configuration

## Technical Highlights

- **Caption capture:** Injects a page-context script that observes YouTube's player caption requests, allowing the extension to use the same caption data requested by the video player.
- **Playback synchronization:** Parses timed transcript segments and updates the sidebar against the current player position while accounting for gaps, video navigation, and advertisements.
- **YouTube SPA support:** Resets video-specific state and refreshes the sidebar when YouTube changes videos without performing a full page reload.
- **Context-aware AI requests:** Sends only relevant context—including nearby captions, selected text, video metadata, and recent messages—to the backend for focused language explanations.
- **Extension/backend separation:** Routes API calls through the Manifest V3 background service worker so the Gemini API key remains in the local backend rather than being exposed in browser code.

## Local Installation

### Prerequisites

- Google Chrome
- Node.js 18+ and npm
- Python 3.10+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### 1. Clone the repository

```bash
git clone https://github.com/ducvo12/youtube-extension2.git
cd youtube-extension2
```

### 2. Build the extension

Install the frontend development dependency and generate the bundled files in `frontend/dist`:

```bash
npm install
npm run build:frontend
```

For automatic rebuilds while editing the frontend, use:

```bash
npm run watch:frontend
```

### 3. Configure and run the backend

From the repository root:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create a file named `.env` inside the `backend` directory:

```dotenv
GEMINI_API_KEY=your_api_key_here
GEMINI_CHAT_MODEL=gemini-3.5-flash-lite
GEMINI_LEARNING_MODEL=gemini-3.5-flash-lite
GEMINI_THINKING_LEVEL=minimal
```

Then start the API on the port expected by the extension:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 4. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `frontend` directory.

If you rebuild the frontend while Chrome is open, return to `chrome://extensions`, reload the extension, and refresh the YouTube tab.

## Trying It Out

1. Keep the backend running locally.
2. Open a YouTube video that has captions.
3. Find the **Language Assistant** sidebar beside the video.
4. Choose a caption track if multiple tracks are available, then select **Load transcript**.
5. Highlight caption text to translate it, or ask a question about the current phrase, grammar, slang, or tone.

The extension currently expects the backend at `http://127.0.0.1:8000` and is intended for local development and testing.

