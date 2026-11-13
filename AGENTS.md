# Role & Goal

You are an expert backend engineer. Your task is to write a complete, production-ready automation system for an academic department. The system monitors a Google Classroom, aggregates teacher submissions (Google Docs/Sheets), applies business logic, and generates a master Google Sheet report, along with scheduled email and messenger notifications.

The code must be fully written, modular, and require no placeholder implementation from me.

# Technical Boundaries & Stack

- **Language & Runtime:** TypeScript on Node.js (fastify).
- **Core Libraries:** `googleapis` (for Classroom, Drive, Sheets, Gmail), `dotenv` (for env variables), `zod` (for strict environment validation), `telegraf` or `node-telegram-bot-api` (for Telegram messenger alerts).
- **Architecture:** A modular CLI application. No GUI. The script should use standard argument parsing (e.g., `process.argv` flags like `--monitor`, `--draft`, `--final`) so it can be triggered via Windows Task Scheduler.
- **Resilience:** Wrap API calls in `try/catch` blocks. If a specific teacher's file is corrupted or missing, log the error and continue processing the rest. Do not crash.

# Project Structure

Please generate the code following this structure:
/
├── src/
│ ├── index.ts # CLI entry point and argument parsing
│ ├── config/
│ │ └── env.ts # Env variables loading and Zod validation
│ ├── services/
│ │ ├── auth.service.ts # Handles Google OAuth2 flow and JWT/token storage
│ │ ├── classroom.service.ts # Fetches assignments and deadlines
│ │ ├── drive.service.ts # Downloads/Uploads files (Docs, Sheets, JPEGs)
│ │ ├── sheets.service.ts # Reads, writes, and formats Google Sheets
│ │ └── notify.service.ts # Handles Gmail sending and Telegram alerts
│ └── core/
│ └── aggregator.ts # Logic for parsing and summing report data
├── package.json
├── tsconfig.json
└── .env.example

# Business Logic & Requirements

**1. Data Sources & Handling**

- **Dynamic Data:** Parse individual teacher submissions attached to the assignment.
- **Static Data:** Copy static rows from two existing Google Sheets: "План роботи кафедри" and "План наукової роботи кафедри". These rows must be pasted exactly as-is into the final master sheet.
- **Aggregation Rules:** Sum all numeric values across teacher reports.
  - _CRITICAL:_ If a cell contains a dash ("-") or the string "інформація відсутня", it must be parsed and calculated as `0`.
- **Metadata:** Extract the exact date the assignment appeared in Google Classroom and write it into the header of the final master Google Sheet.

**2. Execution Timelines (The Workflow)**
The script will be run daily. It must check the current date against the assignment deadline and execute the following logic:

- **Monitoring Phase:** Poll the specified Google Classroom for an assignment named "Інформація про науково-дослідну роботу". Extract its creation date and final deadline.
- **T-minus 3 Days (Draft & Warn):**
  - Generate a preliminary master Google Sheet based _only_ on currently submitted files.
  - Send an email reminder via Gmail to teachers who have not submitted, warning them they have 48 hours left.
  - Send a direct message via Telegram and an email to the Head of Department listing the full names (ПІБ) of the missing teachers.
- **T-minus 1 Day (Reconciliation):**
  - Check for late submissions. Recalculate all sums and update the master Google Sheet.
- **Final Delivery (Deadline Day):**
  - Email the final master Google Sheet link, along with any `.jpeg` attachments found in the submissions, to the scientific department email and the Head of Department.

# Environment Variables (.env)

Provide code that utilizes these exact environment variables:

```env
GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_TOKEN_FILE=token.json
CLASSROOM_COURSE_ID=your_course_id
ASSIGNMENT_NAME="Інформація про науково-дослідну роботу"
TELEGRAM_BOT_TOKEN=your_bot_token
HEAD_OF_DEPT_CHAT_ID=chat_id_here
HEAD_OF_DEPT_EMAIL=head@example.com
SCI_DEPT_EMAIL=science@example.com
STATIC_PLAN_SHEET_ID=sheet_id_1
STATIC_SCI_PLAN_SHEET_ID=sheet_id_2
MASTER_OUTPUT_FOLDER_ID=drive_folder_id

```

# Instructions for Output

1. Output the complete `package.json` with necessary dependencies and `tsconfig.json`.
2. Output the code for all TypeScript files listed in the project structure.
3. Ensure the code includes detailed `console.log` or a simple custom logger so the execution flow can be easily traced in standard output.
4. Do not use generic placeholders like `// TODO: implement API logic`. Write the actual `googleapis` integration code.
