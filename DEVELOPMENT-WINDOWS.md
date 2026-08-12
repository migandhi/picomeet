# Development on Windows

You can manage the repository entirely from Windows with Git.

## 1. Install Node.js

Install Node.js 18+ (the project was designed around Node 20 for deployment).

## 2. Clone

```powershell
git clone https://github.com/YOURNAME/picomeet.git
cd picomeet
```

## 3. Install dependencies

```powershell
npm install
```

## 4. Create local configuration

```powershell
Copy-Item .env.example .env
```

For local browser testing, keep `PM_PUBLIC_URL=http://localhost:8080`.
Camera/microphone access is allowed by browsers on localhost.

## 5. Run

```powershell
npm run dev
```

Open:

```text
http://localhost:8080/
```

## 6. Git workflow

```powershell
git status
git add .
git commit -m "Initial PicoMeet project structure"
git push
```

Do not commit `.env`, database files, backups or `node_modules`.
