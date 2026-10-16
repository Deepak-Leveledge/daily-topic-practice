# Say More

A small Flask website for daily English speaking practice. It gives you a varied topic with a simple explanation and example, then a five-minute timer. The timer only signals when five minutes are complete; you can continue speaking and track extra time. Use the idea button only when you get stuck. At the end of a session, Gemini gives four scores, sentence corrections, a transcript, and a short improvement tip. Open **View weekly review** to compare Monday–Sunday practice, scores, recurring feedback tags, and previous sessions.

## Run locally

1. Install Python 3.10 or newer.
2. In this folder, create and activate a virtual environment, then install dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and add API keys if you have them:

   ```powershell
   Copy-Item .env.example .env
   ```

   Gemini is optional: without a key the app uses its built-in topic bank and prompt ideas. Groq and Gemini keys are both needed only for optional voice feedback.
4. Start the site:

   ```powershell
   py app.py
   ```

5. Open `http://127.0.0.1:5000`.

Session transcripts, feedback, scores, and dates are stored in this browser's IndexedDB. The weekly review compares Monday–Sunday summaries locally, so opening it does not make another Gemini API call. Use **Clear all history** to delete saved sessions from this browser. The recording is kept in memory only for the current session, then sent to Groq for transcription when you finish; the audio itself is not saved in the browser database. Gemini reviews the transcript and supplies feedback and scores. The fluency score is only a rough estimate from transcript text; it cannot measure pauses, speed, or pronunciation. API keys stay on the Python server. For a deployed site, configure environment variables with your hosting provider and serve it with a production WSGI server.
