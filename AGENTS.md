# Product Requirement Document (PRD)
## Project: YouTube Contextual Language Learning Sidebar Extension

### Project Overview & Target Audience
* **Goal:** A Google Chrome Extension that serves as an interactive language-learning assistant directly on YouTube, supported by a custom backend API.
* **Target User:** Intermediate-to-advanced language learners who have moved past basic vocabulary/grammar and want to learn using native video content.
* **Core Philosophy:** Instead of passive word-for-word translation, the extension uses a dedicated sidebar UI to provide real-time transcript tracking, word-level hover lookups, and deep contextual AI explanations for idioms, slang, and advanced grammar structures.


## Git Workflow

When the user says "commit this change" or "commit this", they mean:
1. Check `git status --short --branch` and `git remote -v`.
2. Stage the relevant changes for the current task.
3. Create a local commit on `main` with a concise descriptive message.
4. Push the commit to `origin/main` on GitHub.
5. Report the commit hash and confirm whether the working tree is clean.

Do not push unrelated local changes. If unrelated changes are present, leave them unstaged and mention them.